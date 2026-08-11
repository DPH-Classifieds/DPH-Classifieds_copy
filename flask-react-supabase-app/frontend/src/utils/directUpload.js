import * as tus from 'tus-js-client';
import apiClient from './apiClient';
import { supabase } from './supabaseClient';

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_KEY || '';

export const DIRECT_UPLOAD_STANDARD_LIMIT_BYTES = 6 * 1024 * 1024;
export const LISTING_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

const STORAGE_CACHE_CONTROL = '31536000';
const LISTING_DISPLAY_WIDTH = 1600;
const LISTING_DISPLAY_HEIGHT = 1000;
const TUS_RETRY_DELAYS = [0, 3000, 5000, 10000, 20000];

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const defaultIdFactory = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }

  return `${Date.now()}${Math.random().toString(16).slice(2)}`;
};

const getFileExtension = (fileName = '', fallback = 'jpg') => {
  const raw = String(fileName || '').trim();
  const ext = raw.includes('.') ? raw.split('.').pop() : fallback;
  const normalized = String(ext || fallback).toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized || fallback;
};

const HEIC_MIME = /image\/hei[cf]/i;
const HEIC_EXT = /\.(heic|heif)$/i;

// iPhones upload HEIC/HEIF by default and every browser except Safari fails to
// decode it — so a raw HEIC lands in storage as a broken image and the
// display-variant canvas step (which reads via <img>) can't process it either.
// Convert to JPEG in the browser up front so downstream sees a normal JPEG.
export const ensureUploadableImage = async (file) => {
  if (!file) return file;
  const isHeic = HEIC_MIME.test(file.type || '') || HEIC_EXT.test(file.name || '');
  if (!isHeic) return file;
  const { default: heic2any } = await import('heic2any');
  const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
  const blob = Array.isArray(converted) ? converted[0] : converted;
  const newName = `${String(file.name || 'photo').replace(HEIC_EXT, '')}.jpg`;
  return new File([blob], newName, { type: 'image/jpeg', lastModified: Date.now() });
};

const normalizeCropSettings = (cropSettings = {}) => ({
  focal_x: clamp(Number(cropSettings.focal_x ?? cropSettings.focalX ?? 50) || 50, 0, 100),
  focal_y: clamp(Number(cropSettings.focal_y ?? cropSettings.focalY ?? 50) || 50, 0, 100),
  zoom: clamp(Number(cropSettings.zoom ?? 1) || 1, 1, 3),
});

const loadImageElement = (file) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Failed to load image: ${file.name}`));
    };

    image.src = objectUrl;
  });

const requestSignedUploadUrl = async ({ bucketName, objectPath, upsert = false }) =>
  apiClient.post('/api/storage/signed-upload-url', {
    bucket_name: bucketName,
    object_path: objectPath,
    upsert,
  });

const uploadToSignedUrl = async ({ bucketName, objectPath, token, fileBody, contentType }) => {
  const { data, error } = await supabase.storage.from(bucketName).uploadToSignedUrl(
    objectPath,
    token,
    fileBody,
    {
      cacheControl: STORAGE_CACHE_CONTROL,
      contentType,
    }
  );

  if (error) {
    throw error;
  }

  return data;
};

const uploadToSignedTusUrl = ({ file, bucketName, objectPath, token, onProgress }) =>
  new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${buildSupabaseStorageHost(SUPABASE_URL)}/storage/v1/upload/resumable`,
      retryDelays: TUS_RETRY_DELAYS,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'x-signature': token,
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName,
        objectName: objectPath,
        contentType: file.type || 'application/octet-stream',
        cacheControl: STORAGE_CACHE_CONTROL,
      },
      chunkSize: DIRECT_UPLOAD_STANDARD_LIMIT_BYTES,
      onError: reject,
      onProgress: (bytesUploaded, bytesTotal) => {
        if (typeof onProgress === 'function') {
          onProgress(bytesUploaded, bytesTotal);
        }
      },
      onSuccess: () => resolve(upload.url),
    });

    upload.findPreviousUploads()
      .then((previousUploads) => {
        if (previousUploads.length > 0) {
          upload.resumeFromPreviousUpload(previousUploads[0]);
        }
        upload.start();
      })
      .catch(reject);
  });

const uploadSignedAsset = async ({
  bucketName,
  fileBody,
  objectPath,
  contentType,
  preferResumable = false,
  onProgress,
}) => {
  const signed = await requestSignedUploadUrl({ bucketName, objectPath });

  if (preferResumable) {
    try {
      await uploadToSignedTusUrl({
        file: fileBody,
        bucketName,
        objectPath,
        token: signed.token,
        onProgress,
      });
      return signed;
    } catch (error) {
      await uploadToSignedUrl({
        bucketName,
        objectPath,
        token: signed.token,
        fileBody,
        contentType,
      });
      return signed;
    }
  }

  await uploadToSignedUrl({
    bucketName,
    objectPath,
    token: signed.token,
    fileBody,
    contentType,
  });

  return signed;
};

const LISTING_DISPLAY_MAX = Math.max(LISTING_DISPLAY_WIDTH, LISTING_DISPLAY_HEIGHT);

const buildListingDisplayVariant = async (file, cropSettings = {}) => {
  const image = await loadImageElement(file);
  const normalizedCrop = normalizeCropSettings(cropSettings);

  // The file passed in is already the user's final crop (UnifiedCropper handles
  // shape/aspect, including portrait). Preserve that aspect ratio here — just
  // downscale to fit within the max display box. The old code re-cropped to a
  // fixed 16:10 landscape frame, which discarded the top/bottom of portrait
  // photos; the browse-card frames already normalise the on-screen shape.
  const scale = Math.min(1, LISTING_DISPLAY_MAX / Math.max(image.width, image.height));
  const outWidth = Math.max(1, Math.round(image.width * scale));
  const outHeight = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas rendering is unavailable in this browser.');
  }

  context.drawImage(image, 0, 0, image.width, image.height, 0, 0, outWidth, outHeight);

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((nextBlob) => {
      if (!nextBlob) {
        reject(new Error('Failed to generate the listing display image.'));
        return;
      }

      resolve(nextBlob);
    }, 'image/jpeg', 0.88);
  });

  return {
    blob,
    normalizedCrop,
    crop_meta: {
      source_width: image.width,
      source_height: image.height,
      crop_box: {
        left: 0,
        top: 0,
        right: image.width,
        bottom: image.height,
      },
      zoom: normalizedCrop.zoom,
      display_width: outWidth,
      display_height: outHeight,
    },
  };
};

export const buildSupabaseStorageHost = (supabaseUrl) => {
  const value = String(supabaseUrl || '').trim();
  if (!value) {
    return '';
  }

  const parsed = new URL(value);
  if (parsed.hostname.endsWith('.storage.supabase.co')) {
    return parsed.origin;
  }

  if (parsed.hostname.endsWith('.supabase.co')) {
    parsed.hostname = parsed.hostname.replace(/\.supabase\.co$/, '.storage.supabase.co');
  }

  return parsed.origin;
};

export const buildStorageObjectPath = ({
  userId,
  fileName,
  suffix = '',
  extension,
  idFactory = defaultIdFactory,
}) => {
  const safeUserId = String(userId || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeSuffix = suffix ? `_${String(suffix).replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';
  const safeExtension = String(extension || getFileExtension(fileName, 'jpg'))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') || 'jpg';

  return `${safeUserId}/${idFactory()}${safeSuffix}.${safeExtension}`;
};

export const shouldUseResumableUpload = (fileSize) =>
  Number(fileSize || 0) > DIRECT_UPLOAD_STANDARD_LIMIT_BYTES;

export const uploadListingImagesDirect = async (files, { userId, cropSettings = [], onProgress } = {}) => {
  const uploadedImages = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = await ensureUploadableImage(files[index]);
    const crop = cropSettings[index] || {};
    const originalPath = buildStorageObjectPath({
      userId,
      fileName: file.name,
      extension: getFileExtension(file.name, 'jpg'),
    });

    const originalUpload = await uploadSignedAsset({
      bucketName: 'listing-images',
      fileBody: file,
      objectPath: originalPath,
      contentType: file.type || 'application/octet-stream',
      preferResumable: shouldUseResumableUpload(file.size),
      onProgress: typeof onProgress === 'function'
        ? (bytesUploaded, bytesTotal) => onProgress({ index, bytesUploaded, bytesTotal })
        : undefined,
    });

    const displayVariant = await buildListingDisplayVariant(file, crop);
    const displayPath = buildStorageObjectPath({
      userId,
      fileName: file.name,
      suffix: 'display',
      extension: 'jpg',
    });

    let displayUrl = originalUpload.public_url;
    try {
      const displayUpload = await uploadSignedAsset({
        bucketName: 'listing-images',
        fileBody: displayVariant.blob,
        objectPath: displayPath,
        contentType: 'image/jpeg',
      });
      displayUrl = displayUpload.public_url;
    } catch (error) {
      console.error('Display variant upload failed, falling back to original image URL:', error);
    }

    uploadedImages.push({
      url: originalUpload.public_url,
      image_url: originalUpload.public_url,
      display_url: displayUrl,
      focal_x: displayVariant.normalizedCrop.focal_x,
      focal_y: displayVariant.normalizedCrop.focal_y,
      crop_meta: {
        ...displayVariant.crop_meta,
        sort_index: index,
      },
    });
  }

  return uploadedImages;
};

export const uploadListingImageUrlsDirect = async (files, { userId, onProgress } = {}) => {
  const uploadedUrls = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = await ensureUploadableImage(files[index]);
    const objectPath = buildStorageObjectPath({
      userId,
      fileName: file.name,
      extension: getFileExtension(file.name, 'jpg'),
    });

    const upload = await uploadSignedAsset({
      bucketName: 'listing-images',
      fileBody: file,
      objectPath,
      contentType: file.type || 'application/octet-stream',
      preferResumable: shouldUseResumableUpload(file.size),
      onProgress: typeof onProgress === 'function'
        ? (bytesUploaded, bytesTotal) => onProgress({ index, bytesUploaded, bytesTotal })
        : undefined,
    });

    uploadedUrls.push(upload.public_url);
  }

  return uploadedUrls;
};

export const uploadProfilePhotoDirect = async (rawFile, { userId } = {}) => {
  const file = await ensureUploadableImage(rawFile);
  const objectPath = buildStorageObjectPath({
    userId,
    fileName: file.name,
    extension: getFileExtension(file.name, 'jpg'),
  });

  const upload = await uploadSignedAsset({
    bucketName: 'profile-photos',
    fileBody: file,
    objectPath,
    contentType: file.type || 'application/octet-stream',
  });

  return upload.public_url;
};

export const uploadRegistrationDocument = async (rawFile, { userId } = {}) => {
  const file = await ensureUploadableImage(rawFile);
  const objectPath = buildStorageObjectPath({
    userId,
    fileName: file.name,
    extension: getFileExtension(file.name, 'jpg'),
  });

  const upload = await uploadSignedAsset({
    bucketName: 'registration-documents',
    fileBody: file,
    objectPath,
    contentType: file.type || 'application/octet-stream',
  });

  return upload.public_url;
};
