import { useEffect } from 'react';
import { SITE_NAME, SITE_URL, absoluteUrl } from '../utils/seo';

const upsertMeta = (selector, attributes) => {
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement('meta');
    Object.entries(attributes).forEach(([key, value]) => {
      element.setAttribute(key, value);
    });
    document.head.appendChild(element);
  }

  Object.entries(attributes).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    element.setAttribute(key, value);
  });

  return element;
};

const upsertLink = (selector, attributes) => {
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement('link');
    Object.entries(attributes).forEach(([key, value]) => {
      element.setAttribute(key, value);
    });
    document.head.appendChild(element);
  }

  Object.entries(attributes).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    element.setAttribute(key, value);
  });

  return element;
};

const SeoMeta = ({
  title,
  description,
  canonical,
  image,
  type = 'website',
  keywords,
  noindex = false,
  schema = [],
  siteName = SITE_NAME,
}) => {
  useEffect(() => {
    const canonicalUrl = canonical ? absoluteUrl(canonical) : SITE_URL;
    const resolvedImage = image || `${SITE_URL}/hero.webp`;
    const schemaList = Array.isArray(schema) ? schema.filter(Boolean) : [schema].filter(Boolean);

    if (title) {
      document.title = title;
    }

    upsertMeta('meta[name="description"]', {
      name: 'description',
      content: description || '',
    });

    upsertMeta('meta[name="keywords"]', {
      name: 'keywords',
      content: keywords || '',
    });

    upsertMeta('meta[name="robots"]', {
      name: 'robots',
      content: noindex ? 'noindex, nofollow' : 'index, follow',
    });

    upsertMeta('meta[property="og:type"]', {
      property: 'og:type',
      content: type,
    });
    upsertMeta('meta[property="og:title"]', {
      property: 'og:title',
      content: title || siteName,
    });
    upsertMeta('meta[property="og:description"]', {
      property: 'og:description',
      content: description || '',
    });
    upsertMeta('meta[property="og:url"]', {
      property: 'og:url',
      content: canonicalUrl,
    });
    upsertMeta('meta[property="og:image"]', {
      property: 'og:image',
      content: resolvedImage,
    });
    upsertMeta('meta[property="og:image:secure_url"]', {
      property: 'og:image:secure_url',
      content: resolvedImage,
    });
    upsertMeta('meta[property="og:site_name"]', {
      property: 'og:site_name',
      content: siteName,
    });

    upsertMeta('meta[name="twitter:card"]', {
      name: 'twitter:card',
      content: 'summary_large_image',
    });
    upsertMeta('meta[name="twitter:title"]', {
      name: 'twitter:title',
      content: title || siteName,
    });
    upsertMeta('meta[name="twitter:description"]', {
      name: 'twitter:description',
      content: description || '',
    });
    upsertMeta('meta[name="twitter:image"]', {
      name: 'twitter:image',
      content: resolvedImage,
    });

    upsertLink('link[rel="canonical"]', {
      rel: 'canonical',
      href: canonicalUrl,
    });

    let schemaScript = document.head.querySelector('script[data-dph-seo="jsonld"]');
    if (!schemaScript) {
      schemaScript = document.createElement('script');
      schemaScript.type = 'application/ld+json';
      schemaScript.setAttribute('data-dph-seo', 'jsonld');
      document.head.appendChild(schemaScript);
    }

    if (schemaList.length === 0) {
      schemaScript.textContent = '';
    } else if (schemaList.length === 1) {
      schemaScript.textContent = JSON.stringify(schemaList[0]);
    } else {
      schemaScript.textContent = JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': schemaList,
      });
    }
  }, [title, description, canonical, image, type, keywords, noindex, schema, siteName]);

  return null;
};

export default SeoMeta;
