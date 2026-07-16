import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
  FlatList,
  Switch,
  TextInput,
  Dimensions,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import MapView, { Marker } from '../../utils/mapComponents';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../../utils/apiClient';
import { scanCarRegistration, scanRegistrationDocForText } from '../../utils/ocrScanner';
import { trackEvent } from '../../utils/analytics';
import { useAuth } from '../../context/AuthContext';
import {
  CAR_MAKES,
  CAR_MODELS,
  FUEL_TYPES,
  TRANSMISSION_TYPES,
  EXTERIOR_COLOR_OPTIONS,
  INTERIOR_COLOR_OPTIONS,
  REGIONAL_SPECS,
  BODY_TYPES,
  VEHICLE_CONDITIONS,
  OWNERSHIP_STATUS,
  HORSEPOWER_OPTIONS,
  ENGINE_CAPACITY_OPTIONS,
  SEATING_CAPACITY,
  STEERING_SIDES,
  WARRANTY_OPTIONS,
  SERVICE_HISTORY_OPTIONS,
  DOOR_OPTIONS,
  CYLINDER_OPTIONS,
  PLATE_CITIES,
  PLATE_FORMATS,
  PART_TYPES,
  PART_CONDITIONS,
  BIKE_BRANDS,
  BIKE_TYPES,
  BIKE_FEATURES,
  CAR_EXTRAS,
  getYearOptions,
  UAE_EMIRATES,
  getAreasForEmirate,
} from '../../utils/listingConstants';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import ImageCropperModal from '../../components/ui/ImageCropperModal';
import { compressImage } from '../../utils/imageCompressor';
import { toastApiError } from '../../utils/toast';
import { moderateImage } from '../../utils/imageModeration';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const CATEGORIES = [
  { key: 'car', label: 'Car', icon: 'car' },
  { key: 'bike', label: 'Bike', icon: 'bicycle' },
  { key: 'plate', label: 'Plate', icon: 'key' },
  { key: 'parts', label: 'Parts', icon: 'construct' },
];

const years = getYearOptions();

const PHONE_CODES = ['+971', '+966', '+973', '+974', '+965', '+968', '+92', '+91', '+1', '+44'];

const MAX_DESCRIPTION_WORDS = 300;

const DRAFT_STORAGE_KEYS = {
  car: 'listing_draft_car',
  bike: 'listing_draft_bike',
  plate: 'listing_draft_plate',
  parts: 'listing_draft_parts',
};
const DRAFT_META_KEY = 'listing_draft_meta';

const getDraftStorageKey = (category) => DRAFT_STORAGE_KEYS[category] || DRAFT_STORAGE_KEYS.car;

const countWords = (text) => (text.trim().match(/\S+/g) || []).length;

const limitWords = (text, maxWords) => {
  const words = text.trim().match(/\S+/g) || [];
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ');
};

const getCodeOptions = (city) => {
  const name = typeof city === 'string' ? city : city?.name || '';
  switch (name) {
    case 'Dubai':
      return [...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)), 'AA', 'BB', 'CC', 'DD', 'EE', 'CR'];
    case 'Abu Dhabi':
      return [...Array.from({ length: 20 }, (_, i) => `${i + 1}`), '50'];
    case 'Sharjah':
      return ['White', '1', '2', '3'];
    case 'Ajman':
    case 'Ras Al Khaimah':
    case 'Fujairah':
    case 'Umm Al Quwain':
      return Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
    default:
      return [];
  }
};

const COUNTRY_CODES = PHONE_CODES;

function PickerModal({ visible, onClose, title, options, onSelect, selectedValue }) {
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!visible) setSearch('');
  }, [visible]);

  const filteredOptions = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter((item) => {
      const label = typeof item === 'object' ? item.name || item.label : item;
      return String(label).toLowerCase().includes(q);
    });
  }, [options, search]);

  const renderItem = useCallback(({ item }) => {
    const label = typeof item === 'object' ? item.name || item.label : item;
    const value = typeof item === 'object' ? item.name || item.label : item;
    const isSelected = selectedValue === value || selectedValue === label;
    return (
      <TouchableOpacity
        style={[pickerStyles.option, isSelected && pickerStyles.optionSelected]}
        onPress={() => { onSelect(value); onClose(); }}
        activeOpacity={0.7}
      >
        <Text style={[pickerStyles.optionText, isSelected && pickerStyles.optionTextSelected]}>
          {label}
        </Text>
        {isSelected && <Ionicons name="checkmark" size={18} color={COLORS.accent} />}
      </TouchableOpacity>
    );
  }, [onSelect, onClose, selectedValue]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={pickerStyles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={pickerStyles.sheet}>
          <View style={pickerStyles.handle} />
          <Text style={pickerStyles.title}>{title}</Text>
          <View style={pickerStyles.searchContainer}>
            <Ionicons name="search" size={16} color={COLORS.textMuted} style={{ marginRight: 8 }} />
            <TextInput
              style={pickerStyles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Type to search..."
              placeholderTextColor="rgba(255,255,255,0.3)"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')}>
                <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            )}
          </View>
          <FlatList
            data={filteredOptions}
            renderItem={renderItem}
            keyExtractor={(item, i) => {
              const label = typeof item === 'object' ? item.name || item.label : item;
              return `${label}-${i}`;
            }}
            ItemSeparatorComponent={() => <View style={pickerStyles.separator} />}
            contentContainerStyle={pickerStyles.listContent}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={pickerStyles.emptyText}>No results found</Text>
            }
          />
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const pickerStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.surfaceHigher,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    maxHeight: SCREEN_HEIGHT * 0.6,
    paddingBottom: 30,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: COLORS.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 8,
  },
  title: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  listContent: {
    paddingHorizontal: SPACING.md,
  },
  option: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: BORDER_RADIUS.md,
  },
  optionSelected: {
    backgroundColor: COLORS.primary,
  },
  optionText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    flex: 1,
  },
  optionTextSelected: {
    color: COLORS.accent,
    fontWeight: '600',
  },
  separator: {
    height: 0.5,
    backgroundColor: COLORS.borderLight,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: {
    flex: 1,
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    padding: 0,
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.sm,
    textAlign: 'center',
    paddingVertical: SPACING.lg,
  },
});

function Picker({ label, value, options, onSelect, placeholder }) {
  const [visible, setVisible] = useState(false);
  const displayValue = typeof value === 'string' ? value : '';
  return (
    <View style={styles.pickerContainer}>
      {label && <Text style={styles.pickerLabel}>{label}</Text>}
      <TouchableOpacity style={styles.pickerTrigger} onPress={() => setVisible(true)}>
        <Text style={[styles.pickerText, !displayValue && { color: COLORS.textMuted }]}>
          {displayValue || placeholder || 'Select...'}
        </Text>
        <Ionicons name="chevron-down" size={18} color={COLORS.textSecondary} />
      </TouchableOpacity>
      <PickerModal
        visible={visible}
        onClose={() => setVisible(false)}
        title={label || 'Select'}
        options={options}
        onSelect={onSelect}
        selectedValue={displayValue}
      />
    </View>
  );
}

function CountryCodePicker({ label, value, onSelect }) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={styles.codePickerContainer}>
      {label && <Text style={styles.pickerLabel}>{label}</Text>}
      <TouchableOpacity style={styles.codePickerTrigger} onPress={() => setVisible(true)}>
        <Text style={styles.pickerText}>{value || '+971'}</Text>
        <Ionicons name="chevron-down" size={14} color={COLORS.textSecondary} />
      </TouchableOpacity>
      <PickerModal
        visible={visible}
        onClose={() => setVisible(false)}
        title="Country Code"
        options={COUNTRY_CODES}
        onSelect={onSelect}
        selectedValue={value}
      />
    </View>
  );
}

function PhoneInput({ countryCode, countryCodeLabel, onCountryCodeChange, phoneValue, onPhoneChange, required }) {
  return (
    <View style={styles.phoneRow}>
      <CountryCodePicker
        label={countryCodeLabel}
        value={countryCode}
        onSelect={onCountryCodeChange}
      />
      <View style={styles.phoneInputContainer}>
        <Input
          label={`Phone ${required ? '*' : ''}`}
          value={phoneValue}
          onChangeText={onPhoneChange}
          placeholder="501234567"
          keyboardType="phone-pad"
        />
      </View>
    </View>
  );
}

function ToggleRow({ label, value, onValueChange }) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: COLORS.surfaceHigher, true: COLORS.primaryLight }}
        thumbColor={value ? COLORS.accent : COLORS.textMuted}
      />
    </View>
  );
}

function CollapsibleSection({ title, expanded, onToggle, children, hidden }) {
  if (hidden) return null;
  return (
    <View style={styles.section}>
      <TouchableOpacity style={styles.sectionHeader} onPress={onToggle} activeOpacity={0.7}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={COLORS.textSecondary}
        />
      </TouchableOpacity>
      {expanded && <View style={styles.sectionContent}>{children}</View>}
    </View>
  );
}

function ImageSection({ images, onPickImages, onRemoveImage, onReorderImages }) {
  return (
    <View style={styles.section}>
      <View style={styles.imageHeader}>
        <Text style={styles.sectionTitle}>Photos</Text>
        <Text style={styles.imageCount}>{images.length}/10</Text>
      </View>
      {images.length === 0 ? (
        <TouchableOpacity style={styles.emptyAddImage} onPress={onPickImages} activeOpacity={0.7}>
          <Ionicons name="images-outline" size={40} color={COLORS.accent} />
          <Text style={styles.emptyAddImageTitle}>Add Photos</Text>
          <Text style={styles.emptyAddImageSubtitle}>
            Up to 10. The first photo will be the cover image.
          </Text>
        </TouchableOpacity>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageScroll}>
          {images.map((uri, i) => (
            <View key={`${uri}-${i}`} style={styles.imageThumb}>
              <Image source={{ uri }} style={styles.imageThumbImage} resizeMode="cover" />
              {i === 0 && (
                <View style={styles.imageCoverBadge}>
                  <Ionicons name="star" size={10} color={COLORS.white} />
                  <Text style={styles.imageCoverText}>Cover</Text>
                </View>
              )}
              <TouchableOpacity style={styles.imageRemove} onPress={() => onRemoveImage(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle" size={22} color={COLORS.error} />
              </TouchableOpacity>
              {i > 0 && (
                <TouchableOpacity style={styles.imageReorderLeft} onPress={() => onReorderImages(i, i - 1)}>
                  <Ionicons name="chevron-back" size={14} color={COLORS.white} />
                </TouchableOpacity>
              )}
              {i < images.length - 1 && (
                <TouchableOpacity style={styles.imageReorderRight} onPress={() => onReorderImages(i, i + 1)}>
                  <Ionicons name="chevron-forward" size={14} color={COLORS.white} />
                </TouchableOpacity>
              )}
            </View>
          ))}
          {images.length < 10 && (
            <TouchableOpacity style={styles.addImageBtn} onPress={onPickImages} activeOpacity={0.7}>
              <Ionicons name="add" size={28} color={COLORS.accent} />
              <Text style={styles.addImageText}>Add</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}
      {images.length > 0 && (
        <Text style={styles.imageHint}>Tap arrows to reorder. First photo is the cover.</Text>
      )}
    </View>
  );
}

export default function PostListingScreen({ navigation, route }) {
  const { editMode, listingType, listingId } = route.params || {};
  const isEditMode = !!editMode;
  const { user } = useAuth();
  const [category, setCategory] = useState(null);
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState([]);
  const [cropperUri, setCropperUri] = useState(null);
  const [cropperVisible, setCropperVisible] = useState(false);
  const [moderating, setModerating] = useState(false);

  const [carEmirate, setCarEmirate] = useState('Dubai');
  const [carArea, setCarArea] = useState('');
  const [titleManuallyEdited, setTitleManuallyEdited] = useState(false);
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [lastDraftSave, setLastDraftSave] = useState(null);
  const [carRegistrationScan, setCarRegistrationScan] = useState(null);
  const [bikeOcrStatus, setBikeOcrStatus] = useState('');
  const [plateOcrStatus, setPlateOcrStatus] = useState('');
  const draftTimerRef = React.useRef(null);

  const [carForm, setCarForm] = useState({
    car_manufacturer: '',
    car_model: '',
    trim: '',
    regional_spec: 'GCC',
    make_year: String(new Date().getFullYear()),
    kilometer_driven: '',
    body_type: '',
    is_insured: false,
    vehicle_type: 'Used',
    ownership_status: '',
    expected_selling_price: '',
    car_owner_phone_number: '',
    country_code: '+971',
    listing_title: '',
    car_description: '',
    is_dealer: false,
    fuel_type: '',
    transmission_type: '',
    seating_capacity: '',
    horsepower: '',
    engine_capacity: '',
    steering_side: '',
    color: '',
    interior_color: '',
    cylinders: '',
    doors: '',
    warranty: '',
    service_history: '',
    drivetrain: '',
    fuel_efficiency: '',
    top_speed: '',
    zero_to_hundred: '',
    torque: '',
    seller_name: user?.display_name || (user?.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : '') || '',
    seller_email: user?.email || '',
    contact_preference: 'phone',
    tour_url: '',
    whatsapp_number: '',
    same_as_phone: true,
    vin_number: '',
    car_location: '',
    extras: [],
  });

  const [bikeEmirate, setBikeEmirate] = useState('Dubai');
  const [bikeArea, setBikeArea] = useState('');

  const [bikeForm, setBikeForm] = useState({
    bike_brand: '',
    bike_model: '',
    bike_category: '',
    engine_capacity: '',
    year: '',
    mileage: '',
    color: '',
    condition: 'Good',
    price: '',
    contact_number: '',
    country_code: '+971',
    description: '',
    vin_number: '',
    cylinders: '',
    wheels: '',
    features: [],
    is_dealer: false,
    whatsapp_number: '',
    same_as_phone: true,
  });

  const [plateCity, setPlateCity] = useState(null);
  const [plateArea, setPlateArea] = useState('');

  const [plateForm, setPlateForm] = useState({
    code: '',
    digits: '',
    number: '',
    plate_format: 'Standard',
    price: '',
    description: '',
    contact_phone: '',
    country_code: '+971',
    is_dealer: false,
    whatsapp_number: '',
    same_as_phone: true,
  });

  const [partsEmirate, setPartsEmirate] = useState('Dubai');
  const [partsArea, setPartsArea] = useState('');

  const [partsForm, setPartsForm] = useState({
    name: '',
    part_type: '',
    condition: 'New',
    compatible_makes: '',
    compatible_models: '',
    compatible_years: '',
    price: '',
    description: '',
    contact_number: '',
    country_code: '+971',
    is_negotiable: false,
    is_dealer: false,
    whatsapp_number: '',
    same_as_phone: true,
  });

  const [expandedSections, setExpandedSections] = useState({
    car_basic: true,
    car_specs: false,
    car_extras: false,
    car_location: false,
    car_images: false,
    bike_details: true,
    bike_specs: false,
    bike_features: false,
    bike_contact: false,
    bike_images: false,
    plate_details: true,
    plate_contact: false,
    plate_images: false,
    parts_details: true,
    parts_compatibility: false,
    parts_contact: false,
    parts_images: false,
  });

  const toggleSection = (key) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Smart defaults: rehydrate last-used Emirate/Area on first mount when
  // the user hasn't already overridden them. New post flow only.
  useEffect(() => {
    if (isEditMode) return;
    AsyncStorage.getItem('last_listing_location').then((raw) => {
      if (!raw) return;
      try {
        const { emirate, area } = JSON.parse(raw) || {};
        if (emirate) {
          setCarEmirate((v) => v || emirate);
          setBikeEmirate((v) => v || emirate);
          setPlateCity((v) => v || emirate);
          setPartsEmirate((v) => v || emirate);
        }
        if (area) {
          setCarArea((v) => v || area);
          setBikeArea((v) => v || area);
          setPlateArea((v) => v || area);
          setPartsArea((v) => v || area);
        }
      } catch {}
    }).catch(() => {});
  }, []);

  // Wizard step: 1 = Photos, 2 = Essentials (Basic Details), 3 = Details + Review.
  // Skipped entirely in edit mode (single-screen edit). Reset to 1 when the
  // user picks or changes the category, so re-entering Sell starts over clean.
  const [wizardStep, setWizardStep] = useState(1);
  useEffect(() => { if (!isEditMode) setWizardStep(1); }, [category, isEditMode]);

  // Per-step decide which sections render (and force-expand the active one).
  // Keys mirror those in expandedSections above.
  const sectionsForStep = (cat, step) => {
    if (isEditMode) return null; // null = render everything (single-screen edit)
    if (step === 1) return [`${cat === 'parts' ? 'parts' : cat}_images`];
    if (step === 2) {
      if (cat === 'car') return ['car_basic'];
      if (cat === 'bike') return ['bike_details'];
      if (cat === 'plate') return ['plate_details'];
      return ['parts_details'];
    }
    // step 3 = everything except the section already shown in step 1
    // (Images stays visible too — useful for the review summary).
    if (cat === 'car') return ['car_basic', 'car_specs', 'car_extras', 'car_location', 'car_images'];
    if (cat === 'bike') return ['bike_details', 'bike_contact', 'bike_images'];
    if (cat === 'plate') return ['plate_details', 'plate_contact', 'plate_images'];
    return ['parts_details', 'parts_compatibility', 'parts_contact', 'parts_images'];
  };

  const visibleSections = useMemo(
    () => sectionsForStep(category, wizardStep),
    [category, wizardStep, isEditMode]
  );

  // Force the active step's section to be expanded.
  useEffect(() => {
    if (!visibleSections || visibleSections.length === 0) return;
    setExpandedSections((prev) => {
      const next = { ...prev };
      visibleSections.forEach((k) => { next[k] = true; });
      return next;
    });
  }, [visibleSections]);

  const isSectionVisible = useCallback(
    (key) => !visibleSections || visibleSections.includes(key),
    [visibleSections]
  );

  const pickImages = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      selectionLimit: 1,
      quality: 0.7,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      setCropperUri(result.assets[0].uri);
      setCropperVisible(true);
    }
  }, [images.length]);

  const removeImage = (index) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const reorderImages = (fromIndex, toIndex) => {
    setImages(prev => {
      const newImages = [...prev];
      const [removed] = newImages.splice(fromIndex, 1);
      newImages.splice(toIndex, 0, removed);
      return newImages;
    });
  };

  const buildDraftSnapshot = useCallback(() => ({
    category,
    savedAt: Date.now(),
    images,
    carForm,
    bikeForm,
    plateForm,
    partsForm,
    carEmirate,
    carArea,
    bikeEmirate,
    bikeArea,
    plateCity,
    plateArea,
    partsEmirate,
    partsArea,
    selectedLocation,
    titleManuallyEdited,
    whatsappSameAsPhone,
  }), [
    category,
    images,
    carForm,
    bikeForm,
    plateForm,
    partsForm,
    carEmirate,
    carArea,
    bikeEmirate,
    bikeArea,
    plateCity,
    plateArea,
    partsEmirate,
    partsArea,
    selectedLocation,
    titleManuallyEdited,
    whatsappSameAsPhone,
  ]);

  const applyDraftSnapshot = useCallback((draft) => {
    if (!draft || typeof draft !== 'object') return false;

    const payload = draft.payload || draft.draft_payload || draft;
    const draftCategory = String(draft.category || draft.draft_key || payload.category || payload.draft_key || '').toLowerCase();
    if (!draftCategory) return false;

    setCategory(draftCategory);
    if (Array.isArray(payload.images)) {
      setImages(payload.images);
    }
    if (draftCategory === 'car') {
      const carDraft = payload.carForm || payload.formData || payload;
      if (carDraft && typeof carDraft === 'object') {
        setCarForm((prev) => ({ ...prev, ...carDraft }));
      }
      if (payload.carEmirate) setCarEmirate(payload.carEmirate);
      if (payload.carArea) setCarArea(payload.carArea);
      if (payload.selectedLocation && typeof payload.selectedLocation === 'object') {
        setSelectedLocation(payload.selectedLocation);
      }
    } else if (draftCategory === 'bike') {
      const bikeDraft = payload.bikeForm || payload.formData || payload;
      if (bikeDraft && typeof bikeDraft === 'object') {
        setBikeForm((prev) => ({ ...prev, ...bikeDraft }));
      }
      if (payload.bikeEmirate) setBikeEmirate(payload.bikeEmirate);
      if (payload.bikeArea) setBikeArea(payload.bikeArea);
    } else if (draftCategory === 'plate') {
      const plateDraft = payload.plateForm || payload.formData || payload;
      if (plateDraft && typeof plateDraft === 'object') {
        setPlateForm((prev) => ({ ...prev, ...plateDraft }));
      }
      if (payload.plateCity) setPlateCity(payload.plateCity);
      if (payload.plateArea) setPlateArea(payload.plateArea);
    } else if (draftCategory === 'parts') {
      const partsDraft = payload.partsForm || payload.formData || payload;
      if (partsDraft && typeof partsDraft === 'object') {
        setPartsForm((prev) => ({ ...prev, ...partsDraft }));
      }
      if (payload.partsEmirate) setPartsEmirate(payload.partsEmirate);
      if (payload.partsArea) setPartsArea(payload.partsArea);
    }

    if (typeof payload.titleManuallyEdited === 'boolean') {
      setTitleManuallyEdited(payload.titleManuallyEdited);
    }
    if (typeof payload.whatsappSameAsPhone === 'boolean') {
      setWhatsappSameAsPhone(payload.whatsappSameAsPhone);
    }
    if (payload.savedAt) {
      setLastDraftSave(new Date(payload.savedAt));
    }
    return true;
  }, []);

  // Draft auto-save
  useEffect(() => {
    if (category && !isEditMode) {
      const timer = setTimeout(() => {
        const key = getDraftStorageKey(category);
        const snapshot = buildDraftSnapshot();
        AsyncStorage.multiSet([
          [key, JSON.stringify(snapshot)],
          [DRAFT_META_KEY, JSON.stringify({ category, savedAt: snapshot.savedAt })],
        ]).catch(() => {});
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [category, buildDraftSnapshot, isEditMode]);

  // Backend auto-save draft for the active category.
  useEffect(() => {
    const hasMeaningfulDraft =
      (category === 'car' && (carForm.car_manufacturer || carForm.car_model || carForm.listing_title)) ||
      (category === 'bike' && (bikeForm.bike_brand || bikeForm.bike_model || bikeForm.price)) ||
      (category === 'plate' && (plateCityName || plateForm.code || plateForm.number || plateForm.price)) ||
      (category === 'parts' && (partsForm.name || partsForm.part_type || partsForm.price));

    if (category && hasMeaningfulDraft && !isEditMode) {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      draftTimerRef.current = setTimeout(saveDraft, 5000);
    }
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); };
  }, [
    category,
    carForm,
    carEmirate,
    carArea,
    bikeForm,
    bikeEmirate,
    bikeArea,
    plateForm,
    plateCity,
    plateArea,
    partsForm,
    partsEmirate,
    partsArea,
    selectedLocation,
    isEditMode,
  ]);

  // Restore draft on mount
  useEffect(() => {
    if (!isEditMode) {
      let cancelled = false;

      const loadDraft = async () => {
        try {
          const remote = await apiClient.get('/api/user/drafts');
          const remoteDraft = Array.isArray(remote?.drafts) ? remote.drafts[0] : null;
          if (!cancelled && remoteDraft && applyDraftSnapshot(remoteDraft)) {
            return;
          }
        } catch (remoteErr) {
          // Remote drafts are best-effort; fall back to local storage.
        }

        try {
          const metaRaw = await AsyncStorage.getItem(DRAFT_META_KEY);
          if (!metaRaw || cancelled) return;
          const meta = JSON.parse(metaRaw);
          const key = getDraftStorageKey(meta.category);
          const raw = await AsyncStorage.getItem(key);
          if (!raw || cancelled) return;
          const draft = JSON.parse(raw);
          if (draft.savedAt > Date.now() - 86400000) {
            Alert.alert('Restore Draft', 'You have an unsaved listing. Restore it?', [
              { text: 'No', onPress: async () => {
                await AsyncStorage.multiRemove([key, DRAFT_META_KEY]);
              } },
              { text: 'Yes', onPress: () => {
                applyDraftSnapshot(draft);
              } },
            ]);
          }
        } catch (draftErr) {
          // Ignore parse errors and continue with a clean form.
        }
      };

      loadDraft();

      return () => { cancelled = true; };
    }
  }, [applyDraftSnapshot, isEditMode]);

  const updateCarForm = (key, value) => setCarForm(prev => ({ ...prev, [key]: value }));
  const updateBikeForm = (key, value) => setBikeForm(prev => ({ ...prev, [key]: value }));
  const updatePlateForm = (key, value) => setPlateForm(prev => ({ ...prev, [key]: value }));
  const updatePartsForm = (key, value) => setPartsForm(prev => ({ ...prev, [key]: value }));

  const useMyLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location permission is required to use this feature.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      setSelectedLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
    } catch (err) {
      Alert.alert('Error', 'Could not get your location.');
    }
  };

  const saveDraft = async () => {
    try {
      if (!category || isEditMode) return;

      const snapshot = buildDraftSnapshot();
      const key = getDraftStorageKey(category);
      await AsyncStorage.multiSet([
        [key, JSON.stringify(snapshot)],
        [DRAFT_META_KEY, JSON.stringify({ category, savedAt: snapshot.savedAt })],
      ]);
      await apiClient.post(`/api/user/drafts/${category}`, {
        payload: snapshot,
      });
      setLastDraftSave(new Date(snapshot.savedAt));
    } catch (err) {
      // Silent fail for drafts
    }
  };

  const availableModels = carForm.car_manufacturer ? (CAR_MODELS[carForm.car_manufacturer] || []) : [];

  useEffect(() => {
    if (carForm.car_manufacturer && !CAR_MODELS[carForm.car_manufacturer]) {
      setCarForm(prev => ({ ...prev, car_model: '' }));
    }
    if (carForm.car_manufacturer && carForm.car_model && CAR_MODELS[carForm.car_manufacturer]) {
      if (!CAR_MODELS[carForm.car_manufacturer].includes(carForm.car_model)) {
        setCarForm(prev => ({ ...prev, car_model: '' }));
      }
    }
  }, [carForm.car_manufacturer]);

  useEffect(() => {
    if (!titleManuallyEdited && carForm.car_manufacturer && carForm.car_model && carForm.make_year) {
      const newTitle = `${carForm.make_year} ${carForm.car_manufacturer} ${carForm.car_model}${carForm.trim ? ` ${carForm.trim}` : ''}`;
      setCarForm(prev => ({ ...prev, listing_title: newTitle }));
    }
  }, [titleManuallyEdited, carForm.car_manufacturer, carForm.car_model, carForm.make_year, carForm.trim]);

  const plateCityName = typeof plateCity === 'string' ? plateCity : plateCity?.name || '';

  useEffect(() => {
    if (!plateCityName) {
      setPlateForm(prev => ({ ...prev, code: '' }));
      return;
    }
    const codeOpts = getCodeOptions(plateCityName);
    setPlateForm(prev => ({
      ...prev,
      code: codeOpts.includes(prev.code) ? prev.code : '',
    }));
  }, [plateCityName]);

  useEffect(() => {
    if (carEmirate) {
      const areas = getAreasForEmirate(carEmirate);
      if (carArea && !areas.includes(carArea)) {
        setCarArea('');
      }
    }
  }, [carEmirate]);

  useEffect(() => {
    if (bikeEmirate) {
      const areas = getAreasForEmirate(bikeEmirate);
      if (bikeArea && !areas.includes(bikeArea)) {
        setBikeArea('');
      }
    }
  }, [bikeEmirate]);

  useEffect(() => {
    if (plateCityName) {
      const areas = getAreasForEmirate(plateCityName);
      if (plateArea && !areas.includes(plateArea)) {
        setPlateArea('');
      }
    }
  }, [plateCityName]);

  useEffect(() => {
    if (partsEmirate) {
      const areas = getAreasForEmirate(partsEmirate);
      if (partsArea && !areas.includes(partsArea)) {
        setPartsArea('');
      }
    }
  }, [partsEmirate]);

  useEffect(() => {
    if (isEditMode && listingId && listingType) {
      loadListingForEdit();
    }
  }, [isEditMode, listingId, listingType]);

  const loadListingForEdit = async () => {
    try {
      setLoading(true);
      const endpointMap = { car: 'cars', bike: 'bikes', plate: 'plates', parts: 'parts' };
      const data = await apiClient.get(`/api/${endpointMap[listingType]}/${listingId}`);

      setCategory(listingType);

      if (listingType === 'car') {
        setCarForm({
          car_manufacturer: data.car_manufacturer || '',
          car_model: data.car_model || '',
          trim: data.trim || '',
          regional_spec: data.regional_spec || 'GCC',
          make_year: String(data.make_year || ''),
          kilometer_driven: String(data.kilometer_driven || ''),
          body_type: data.body_type || '',
          is_insured: data.is_insured || false,
          vehicle_type: data.vehicle_type || 'Used',
          ownership_status: data.ownership_status || '',
          expected_selling_price: String(data.expected_selling_price || ''),
          car_owner_phone_number: data.car_owner_phone_number || '',
          country_code: data.country_code || '+971',
          listing_title: data.listing_title || '',
          car_description: data.car_description || '',
          is_dealer: data.is_dealer || false,
          fuel_type: data.fuel_type || '',
          transmission_type: data.transmission_type || '',
          seating_capacity: String(data.seating_capacity || ''),
          horsepower: data.horsepower || '',
          engine_capacity: data.engine_capacity || '',
          steering_side: data.steering_side || '',
          color: data.color || data.exterior_color || '',
          interior_color: data.interior_color || '',
          cylinders: String(data.cylinders || ''),
          doors: String(data.doors || ''),
          warranty: data.warranty || '',
          service_history: data.service_history || '',
          drivetrain: data.drivetrain || '',
          fuel_efficiency: String(data.fuel_efficiency || ''),
          top_speed: String(data.top_speed || ''),
          zero_to_hundred: String(data.zero_to_hundred || ''),
          torque: String(data.torque || ''),
          seller_name: data.seller_name || '',
          seller_email: data.seller_email || '',
          contact_preference: data.contact_preference || 'phone',
          tour_url: data.tour_url || '',
          whatsapp_number: data.whatsapp_number || '',
          same_as_phone: true,
          vin_number: data.vin_number || '',
          car_location: data.car_location || '',
          extras: data.extras || [],
        });
        setCarEmirate(data.emirate || data.car_city || 'Dubai');
        setCarArea(data.area || '');
        setTitleManuallyEdited(true);
      }

      if (listingType === 'bike') {
        setBikeForm({
          bike_brand: data.bike_brand || data.bike_manufacturer || '',
          bike_model: data.bike_model || '',
          bike_category: data.bike_category || data.bike_type || '',
          engine_capacity: String(data.engine_capacity || data.engine_size || ''),
          year: String(data.year || ''),
          mileage: String(data.mileage || ''),
          color: data.color || '',
          condition: data.condition || 'Good',
          price: String(data.price || ''),
          contact_number: data.contact_number || '',
          country_code: data.country_code || '+971',
          description: data.description || '',
          vin_number: data.vin_number || '',
          cylinders: String(data.cylinders || ''),
          wheels: String(data.wheels || ''),
          features: data.features || [],
          is_dealer: data.is_dealer || false,
          whatsapp_number: data.whatsapp_number || '',
          same_as_phone: true,
        });
        setBikeEmirate(data.emirate || 'Dubai');
        setBikeArea(data.area || data.location || '');
      }

      if (listingType === 'plate') {
        setPlateForm({
          code: data.code || '',
          digits: String(data.digits || ''),
          number: String(data.number || ''),
          plate_format: data.plate_format || 'Standard',
          price: String(data.price || ''),
          description: data.description || '',
          contact_phone: data.contact_phone || '',
          country_code: data.country_code || '+971',
          is_dealer: data.is_dealer || false,
          whatsapp_number: data.whatsapp_number || '',
          same_as_phone: true,
        });
        setPlateCity(data.city || data.emirate || null);
        setPlateArea(data.area || '');
      }

      if (listingType === 'parts') {
        setPartsForm({
          name: data.name || '',
          part_type: data.part_type || '',
          condition: data.condition || 'New',
          compatible_makes: Array.isArray(data.compatible_makes) ? data.compatible_makes.join(', ') : (data.compatible_makes || ''),
          compatible_models: Array.isArray(data.compatible_models) ? data.compatible_models.join(', ') : (data.compatible_models || ''),
          compatible_years: data.compatible_years || '',
          price: String(data.price || ''),
          description: data.description || '',
          contact_number: data.contact_number || '',
          country_code: data.country_code || '+971',
          is_negotiable: data.is_negotiable || false,
          is_dealer: data.is_dealer || false,
          whatsapp_number: data.whatsapp_number || '',
          same_as_phone: true,
        });
        setPartsEmirate(data.emirate || 'Dubai');
        setPartsArea(data.area || data.location || '');
      }

      if (data.images && Array.isArray(data.images)) {
        setImages(data.images.map(img => typeof img === 'string' ? img : img.url || img.uri));
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to load listing for editing.');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  };

  const carAreaOptions = getAreasForEmirate(carEmirate);
  const bikeAreaOptions = getAreasForEmirate(bikeEmirate);
  const plateAreaOptions = getAreasForEmirate(plateCityName);
  const partsAreaOptions = getAreasForEmirate(partsEmirate);

  const descriptionWordCount = countWords(carForm.car_description || '');

  const getImageMimeType = (uri) => {
    const cleanUri = String(uri || '').split('?')[0].toLowerCase();
    const extension = cleanUri.includes('.') ? cleanUri.split('.').pop() : 'jpg';
    switch (extension) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      case 'heic':
      case 'heif':
        return 'image/heic';
      case 'gif':
        return 'image/gif';
      default:
        return 'image/jpeg';
    }
  };

  const uploadListingImages = useCallback(async (imageUris) => {
    if (!imageUris || imageUris.length === 0) return [];

    const formData = new FormData();
    imageUris.forEach((uri, index) => {
      formData.append('images', {
        uri,
        type: getImageMimeType(uri),
        name: `image_${index}.jpg`,
      });
    });

    const uploadResponse = await apiClient.post('/api/upload-images', formData);
    const urls =
      uploadResponse?.absolute_urls ||
      uploadResponse?.urls ||
      uploadResponse?.images?.map((image) => image?.url || image?.image_url || image?.display_url).filter(Boolean) ||
      [];

    return urls.filter(Boolean);
  }, []);

  const runRegistrationDocScan = ({ setStatus, updateForm, fieldName, pattern }) => {
    const scan = async (source) => {
      setStatus('scanning');
      try {
        const result = await scanRegistrationDocForText({ source });
        if (!result) {
          setStatus('');
          return;
        }
        if (result.documentUrl) updateForm('registration_doc_url', result.documentUrl);
        const match = result.text.match(pattern);
        if (match) {
          updateForm(fieldName, match[0]);
          setStatus('done');
        } else {
          setStatus('not-found');
        }
      } catch (err) {
        if (__DEV__) console.error('Registration doc scan failed:', err);
        setStatus('service-error');
      }
    };
    Alert.alert(
      'Scan Registration Document',
      'Choose a source for the registration document.',
      [
        { text: 'Take Photo', onPress: () => scan('camera') },
        { text: 'Choose from Photos', onPress: () => scan('library') },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  const toggleCarExtra = (extra) => {
    setCarForm(prev => {
      const extras = prev.extras.includes(extra)
        ? prev.extras.filter(e => e !== extra)
        : [...prev.extras, extra];
      return { ...prev, extras };
    });
  };

  const handleSubmit = useCallback(async () => {
    if (!user?.phone_verified) {
      Alert.alert(
        'Phone Verification Required',
        'Please verify your phone number before posting a listing.',
        [
          { text: 'Verify Now', onPress: () => navigation.navigate('Profile', { screen: 'VerifyPhone' }) },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }
    try {
      setLoading(true);
      let endpoint;
      let payload = null;
      const isLocalImageUri = (uri) => {
        const value = String(uri || '');
        return value.startsWith('file:') || value.startsWith('content:') || value.startsWith('ph:');
      };
      const existingImageUrls = images.filter((uri) => uri && !isLocalImageUri(uri));
      const newImageUris = images.filter((uri) => uri && isLocalImageUri(uri));
      const uploadedImageUrls = newImageUris.length > 0 ? await uploadListingImages(newImageUris) : [];
      const finalImageUrls = [...existingImageUrls, ...uploadedImageUrls];

      if (category === 'car' && finalImageUrls.length < 3) {
        Alert.alert('Required', 'Please add at least 3 car images before posting.');
        setLoading(false);
        return;
      }

      if (category === 'bike' && finalImageUrls.length < 3) {
        Alert.alert('Required', 'Please add at least 3 bike images before posting.');
        setLoading(false);
        return;
      }

      if (newImageUris.length > 0 && uploadedImageUrls.length === 0) {
        Alert.alert('Error', 'Failed to upload images. Please try again.');
        setLoading(false);
        return;
      }

      if (isEditMode) {
        const endpointMap = { car: 'cars', bike: 'bikes', plate: 'plates', parts: 'parts' };
        endpoint = `/api/${endpointMap[listingType]}/${listingId}`;
      }

      if (category === 'car') {
        if (!carForm.car_manufacturer || !carForm.car_model || !carForm.make_year || !carForm.expected_selling_price || !carForm.kilometer_driven || !carForm.body_type || !carForm.color || !carForm.regional_spec || !carForm.car_owner_phone_number || !carForm.car_description || !carForm.fuel_type || carForm.fuel_type === 'Other' || !carForm.transmission_type) {
          Alert.alert('Required', 'Please complete all required car fields.');
          setLoading(false);
          return;
        }
        const phone = `${carForm.country_code || '+971'}${carForm.car_owner_phone_number || ''}`.replace(/[^0-9+]/g, '');
        payload = {
          ...carForm,
          emirate: carEmirate,
          area: carArea,
          car_city: carEmirate,
          latitude: selectedLocation?.latitude || 25.276987,
          longitude: selectedLocation?.longitude || 55.296249,
          whatsapp_number: carForm.same_as_phone
            ? phone
            : `${carForm.country_code || '+971'}${carForm.whatsapp_number || ''}`.replace(/[^0-9+]/g, ''),
          whatsapp_prefill_text: `Hi, I'm interested in your ${carForm.car_manufacturer} ${carForm.car_model} listed on DPH Classifieds for AED ${carForm.expected_selling_price}. Is it still available?`,
          images: finalImageUrls,
        };
        if (!isEditMode) endpoint = '/api/cars';
      } else if (category === 'bike') {
        if (!bikeForm.bike_brand || !bikeForm.bike_model || !bikeForm.make_year || !bikeForm.mileage || !bikeForm.price || !bikeForm.engine_capacity || !bikeForm.contact_number || !bikeForm.description || !bikeArea) {
          Alert.alert('Required', 'Please complete all required bike fields.');
          setLoading(false);
          return;
        }
        const phone = `${bikeForm.country_code || '+971'}${bikeForm.contact_number || ''}`.replace(/[^0-9+]/g, '');
        payload = {
          ...bikeForm,
          bike_type: bikeForm.bike_category,
          engine_size: bikeForm.engine_capacity,
          emirate: bikeEmirate,
          area: bikeArea,
          location: bikeArea,
          latitude: selectedLocation?.latitude || 25.276987,
          longitude: selectedLocation?.longitude || 55.296249,
          whatsapp_number: bikeForm.same_as_phone
            ? phone
            : `${bikeForm.country_code || '+971'}${bikeForm.whatsapp_number || ''}`.replace(/[^0-9+]/g, ''),
          whatsapp_prefill_text: `Hi, I'm interested in your ${bikeForm.bike_brand} ${bikeForm.bike_model} listed on DPH Classifieds for AED ${bikeForm.price}. Is it still available?`,
          images: finalImageUrls,
        };
        if (!isEditMode) endpoint = '/api/bikes';
      } else if (category === 'plate') {
        if (!plateCityName || !plateForm.price) {
          Alert.alert('Required', 'City and Price are required.');
          setLoading(false);
          return;
        }
        const phone = `${plateForm.country_code || '+971'}${plateForm.contact_phone || ''}`.replace(/[^0-9+]/g, '');
        payload = {
          ...plateForm,
          city: plateCityName,
          emirate: plateCityName,
          area: plateArea,
          latitude: selectedLocation?.latitude || 25.276987,
          longitude: selectedLocation?.longitude || 55.296249,
          contact_phone: phone,
          whatsapp_number: plateForm.same_as_phone
            ? phone
            : `${plateForm.country_code || '+971'}${plateForm.whatsapp_number || ''}`.replace(/[^0-9+]/g, ''),
          whatsapp_prefill_text: `Hi, I'm interested in your ${plateCityName} plate "${plateForm.code} ${plateForm.number}" listed on DPH Classifieds for AED ${plateForm.price}. Is it still available?`,
          images: finalImageUrls,
        };
        if (!isEditMode) endpoint = '/api/plates';
      } else if (category === 'parts') {
        if (!partsForm.name || !partsForm.price) {
          Alert.alert('Required', 'Part Name and Price are required.');
          setLoading(false);
          return;
        }
        const phone = `${partsForm.country_code || '+971'}${partsForm.contact_number || ''}`.replace(/[^0-9+]/g, '');
        payload = {
          ...partsForm,
          emirate: partsEmirate,
          area: partsArea,
          location: partsArea,
          latitude: selectedLocation?.latitude || 25.276987,
          longitude: selectedLocation?.longitude || 55.296249,
          contact_number: phone,
          whatsapp_number: partsForm.same_as_phone
            ? phone
            : `${partsForm.country_code || '+971'}${partsForm.whatsapp_number || ''}`.replace(/[^0-9+]/g, ''),
          whatsapp_prefill_text: `Hi, I'm interested in your "${partsForm.name}" listed on DPH Classifieds for AED ${partsForm.price}. Is it still available?`,
          compatible_makes: partsForm.compatible_makes
            ? partsForm.compatible_makes.split(',').map(s => s.trim()).filter(Boolean)
            : [],
          compatible_models: partsForm.compatible_models
            ? partsForm.compatible_models.split(',').map(s => s.trim()).filter(Boolean)
            : [],
          images: finalImageUrls,
        };
        if (!isEditMode) endpoint = '/api/parts';
      }

      if (!payload || !endpoint) {
        throw new Error('Unable to determine listing payload.');
      }

      if (isEditMode) {
        await apiClient.put(endpoint, payload);
      } else {
        await apiClient.post(endpoint, payload);
      }
      if (category) {
        await AsyncStorage.multiRemove([getDraftStorageKey(category), DRAFT_META_KEY]);
        apiClient.delete(`/api/user/drafts/${category}`).catch(() => {});
      }
      if (!isEditMode) {
        // Persist last-used location for the next listing — saves the seller
        // from re-picking the same Emirate/Area on every post.
        const lastEmirate = category === 'car' ? carEmirate
          : category === 'bike' ? bikeEmirate
          : category === 'plate' ? plateCityName
          : partsEmirate;
        const lastArea = category === 'car' ? carArea
          : category === 'bike' ? bikeArea
          : category === 'plate' ? plateArea
          : partsArea;
        AsyncStorage.setItem('last_listing_location', JSON.stringify({
          emirate: lastEmirate, area: lastArea,
        })).catch(() => {});
        trackEvent('post_listing_success', {
          listing_type: category,
          platform: 'mobile',
        });
      }
      Alert.alert('Success', isEditMode ? 'Your listing has been updated!' : 'Your listing has been posted!', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      toastApiError(err);
      Alert.alert('Error', err.message || 'Failed to post listing. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [category, carForm, bikeForm, plateForm, partsForm, images, navigation, carEmirate, carArea, bikeEmirate, bikeArea, plateCityName, plateArea, partsEmirate, partsArea, uploadListingImages, isEditMode, listingType, listingId, user?.phone_verified]);

  const resetAndGoBack = () => {
    if (isEditMode) {
      navigation.goBack();
    } else {
      setCategory(null);
      setImages([]);
    }
  };

  // ==================== CATEGORY SELECTION ====================
  if (!category) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Post a Listing</Text>
          <Text style={styles.headerSubtitle}>Choose a category</Text>
        </View>
        <View style={styles.categoryGrid}>
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat.key}
              style={styles.categoryCard}
              activeOpacity={0.7}
              onPress={() => setCategory(cat.key)}
            >
              <Ionicons name={cat.icon} size={40} color={COLORS.accent} />
              <Text style={styles.categoryLabel}>{cat.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </SafeAreaView>
    );
  }

  // ==================== CAR FORM ====================
  const renderCarForm = () => (
    <View>
      <CollapsibleSection title="Basic Details" expanded={expandedSections.car_basic} onToggle={() => toggleSection('car_basic')} hidden={!isSectionVisible('car_basic')}>
        <Text style={styles.fieldLabel}>Emirate *</Text>
        <Picker
          value={carEmirate}
          options={UAE_EMIRATES}
          onSelect={setCarEmirate}
          placeholder="Select Emirate"
        />

        {carAreaOptions.length > 0 ? (
          <Picker
            label="Area *"
            value={carArea}
            options={carAreaOptions}
            onSelect={setCarArea}
            placeholder="Select Area"
          />
        ) : (
          <Input
            label="Area *"
            value={carArea}
            onChangeText={setCarArea}
            placeholder="Area"
          />
        )}

        <Text style={styles.fieldLabel}>Make *</Text>
        <Picker
          value={carForm.car_manufacturer}
          options={['', ...CAR_MAKES]}
          onSelect={(v) => updateCarForm('car_manufacturer', v)}
          placeholder="Select Make"
        />

        <TouchableOpacity
          style={styles.scanButton}
          onPress={() => {
            const runScan = async (source) => {
              try {
                const data = await scanCarRegistration({
                  source,
                  documentType: 'mulkiya',
                  listingType: 'car',
                  listingId: isEditMode ? listingId : null,
                });
                if (data) {
                  setCarRegistrationScan(data);
                  if (data.shouldAutoFill) {
                    if (data.fields.make) updateCarForm('car_manufacturer', data.fields.make);
                    if (data.fields.model) updateCarForm('car_model', data.fields.model);
                    if (data.fields.year) updateCarForm('make_year', String(data.fields.year));
                    if (data.fields.vin) updateCarForm('vin_number', data.fields.vin);
                    Alert.alert('Scan Complete', 'Registration details were verified and applied.');
                  } else {
                    Alert.alert(
                      'Review Required',
                      'We found registration details, but they need review before they are applied automatically.'
                    );
                  }
                }
              } catch (err) {
                Alert.alert('Scan Failed', err.message || 'Could not read registration.');
              }
            };
            Alert.alert(
              'Scan Registration',
              'Choose a source for the registration document.',
              [
                { text: 'Take Photo', onPress: () => runScan('camera') },
                { text: 'Choose from Photos', onPress: () => runScan('library') },
                { text: 'Choose File (PDF / Image)', onPress: () => runScan('file') },
                { text: 'Cancel', style: 'cancel' },
              ],
            );
          }}
        >
          <Ionicons name="scan-outline" size={20} color={COLORS.accent} />
          <Text style={styles.scanButtonText}>Scan Registration</Text>
        </TouchableOpacity>
        <Text style={styles.scanDisclaimer}>
          Scanned text may be inaccurate — please double-check before submitting. Uploaded documents may be retained to improve this scanner (see our Privacy Policy).
        </Text>

        {carRegistrationScan && (
          <View style={styles.scanResultCard}>
            <View style={styles.scanResultHeader}>
              <Text style={styles.scanResultTitle}>Registration Scan</Text>
              <Text style={[
                styles.scanResultBadge,
                carRegistrationScan.shouldAutoFill ? styles.scanResultBadgeVerified : styles.scanResultBadgeReview,
              ]}>
                {carRegistrationScan.shouldAutoFill ? 'Verified' : 'Needs Review'}
              </Text>
            </View>
            <Text style={styles.scanResultLine}>Make: {carRegistrationScan.fields.make || '—'}</Text>
            <Text style={styles.scanResultLine}>Model: {carRegistrationScan.fields.model || '—'}</Text>
            <Text style={styles.scanResultLine}>Year: {carRegistrationScan.fields.year || '—'}</Text>
            <Text style={styles.scanResultLine}>VIN: {carRegistrationScan.fields.vin || '—'}</Text>
            <Text style={styles.scanResultMeta}>
              Confidence: {Math.round((carRegistrationScan.confidence.overall || 0) * 100)}%
            </Text>
            <Text style={styles.scanResultMeta}>
              VIN Validation: {carRegistrationScan.vinValidation.valid ? 'Valid' : 'Needs Review'}
            </Text>
            {carRegistrationScan.reviewReasons.length > 0 && (
              <Text style={styles.scanResultMeta}>
                Review Reasons: {carRegistrationScan.reviewReasons.join(', ')}
              </Text>
            )}
          </View>
        )}

        <Text style={styles.fieldLabel}>Model *</Text>
        <Picker
          value={carForm.car_model}
          options={['', ...availableModels]}
          onSelect={(v) => updateCarForm('car_model', v)}
          placeholder={carForm.car_manufacturer ? 'Select Model' : 'Select Make first'}
        />

        <Input
          label="Trim"
          value={carForm.trim}
          onChangeText={(v) => updateCarForm('trim', v)}
          placeholder="e.g. SE, Limited"
        />

        <Text style={styles.fieldLabel}>Regional Spec *</Text>
        <Picker
          value={carForm.regional_spec}
          options={REGIONAL_SPECS}
          onSelect={(v) => updateCarForm('regional_spec', v)}
          placeholder="Select Regional Spec"
        />

        <Text style={styles.fieldLabel}>Year *</Text>
        <Picker
          value={carForm.make_year}
          options={years}
          onSelect={(v) => updateCarForm('make_year', v)}
          placeholder="Select Year"
        />

        <Input
          label="Mileage (km) *"
          value={carForm.kilometer_driven}
          onChangeText={(v) => updateCarForm('kilometer_driven', v)}
          placeholder="e.g. 50000"
          keyboardType="numeric"
        />

        <Text style={styles.fieldLabel}>Body Type *</Text>
        <Picker
          value={carForm.body_type}
          options={['', ...BODY_TYPES]}
          onSelect={(v) => updateCarForm('body_type', v)}
          placeholder="Select Body Type"
        />

        <Text style={styles.fieldLabel}>Insured in UAE?</Text>
        <Picker
          value={carForm.is_insured ? 'Yes' : 'No'}
          options={['No', 'Yes']}
          onSelect={(v) => updateCarForm('is_insured', v === 'Yes')}
        />

        <Text style={styles.fieldLabel}>Condition *</Text>
        <Picker
          value={carForm.vehicle_type}
          options={VEHICLE_CONDITIONS}
          onSelect={(v) => updateCarForm('vehicle_type', v)}
          placeholder="Select Condition"
        />

        <Text style={styles.fieldLabel}>Ownership</Text>
        <Picker
          value={carForm.ownership_status}
          options={['', ...OWNERSHIP_STATUS]}
          onSelect={(v) => updateCarForm('ownership_status', v)}
          placeholder="Select Ownership"
        />

        <Input
          label="Price (AED) *"
          value={carForm.expected_selling_price}
          onChangeText={(v) => updateCarForm('expected_selling_price', v)}
          placeholder="e.g. 55000"
          keyboardType="numeric"
        />

        <PhoneInput
          countryCodeLabel="Country Code"
          countryCode={carForm.country_code}
          onCountryCodeChange={(v) => updateCarForm('country_code', v)}
          phoneValue={carForm.car_owner_phone_number}
          onPhoneChange={(v) => updateCarForm('car_owner_phone_number', v)}
          required
        />

        <ToggleRow
          label="WhatsApp same as phone"
          value={carForm.same_as_phone}
          onValueChange={(v) => {
            updateCarForm('same_as_phone', v);
            if (v) updateCarForm('whatsapp_number', '');
          }}
        />
        {!carForm.same_as_phone && (
          <PhoneInput
            countryCodeLabel="WhatsApp Code"
            countryCode={carForm.country_code}
            onCountryCodeChange={(v) => updateCarForm('country_code', v)}
            phoneValue={carForm.whatsapp_number}
            onPhoneChange={(v) => updateCarForm('whatsapp_number', v)}
          />
        )}

        <Input
          label="Tour URL"
          value={carForm.tour_url}
          onChangeText={(v) => updateCarForm('tour_url', v)}
          placeholder="https://virtual-tour-link.com"
          keyboardType="url"
        />

        <Input
          label="Listing Title *"
          value={carForm.listing_title}
          onChangeText={(v) => {
            setTitleManuallyEdited(true);
            updateCarForm('listing_title', v);
          }}
          placeholder="Auto-generated from year + make + model"
        />

        <View>
          <Text style={styles.fieldLabel}>Description *</Text>
          <Text style={styles.charCounter}>{descriptionWordCount}/{MAX_DESCRIPTION_WORDS} words</Text>
          <Input
            value={carForm.car_description}
            onChangeText={(v) => updateCarForm('car_description', limitWords(v, MAX_DESCRIPTION_WORDS))}
            placeholder="Include service history, accident history, upgrades, ownership, and reason for sale."
            multiline
          />
        </View>

        <ToggleRow
          label="Dealer Listing"
          value={carForm.is_dealer}
          onValueChange={(v) => updateCarForm('is_dealer', v)}
        />

        <Input
          label="Seller Name"
          value={carForm.seller_name}
          onChangeText={(v) => updateCarForm('seller_name', v)}
          placeholder="Your name or business name"
        />

        <Input
          label="Seller Email"
          value={carForm.seller_email}
          onChangeText={(v) => updateCarForm('seller_email', v)}
          placeholder="contact@example.com"
          keyboardType="email-address"
        />

        <Text style={styles.fieldLabel}>Contact Preference</Text>
        <Picker
          value={carForm.contact_preference}
          options={['phone', 'email', 'whatsapp']}
          onSelect={(v) => updateCarForm('contact_preference', v)}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Specifications" expanded={expandedSections.car_specs} onToggle={() => toggleSection('car_specs')} hidden={!isSectionVisible('car_specs')}>
        <Text style={styles.fieldLabel}>Fuel Type *</Text>
        <Picker
          value={carForm.fuel_type}
          options={['', ...FUEL_TYPES]}
          onSelect={(v) => updateCarForm('fuel_type', v)}
          placeholder="Select Fuel Type"
        />

        <Text style={styles.fieldLabel}>Transmission *</Text>
        <Picker
          value={carForm.transmission_type}
          options={['', ...TRANSMISSION_TYPES]}
          onSelect={(v) => updateCarForm('transmission_type', v)}
          placeholder="Select Transmission"
        />

        <Text style={styles.fieldLabel}>Seating Capacity</Text>
        <Picker
          value={carForm.seating_capacity}
          options={['', ...SEATING_CAPACITY]}
          onSelect={(v) => updateCarForm('seating_capacity', v)}
          placeholder="Select Seating Capacity"
        />

        <Text style={styles.fieldLabel}>Horsepower *</Text>
        <Picker
          value={carForm.horsepower}
          options={['', ...HORSEPOWER_OPTIONS]}
          onSelect={(v) => updateCarForm('horsepower', v)}
          placeholder="Select Horsepower"
        />

        <Text style={styles.fieldLabel}>Engine Capacity (cc)</Text>
        <Picker
          value={carForm.engine_capacity}
          options={['', ...ENGINE_CAPACITY_OPTIONS]}
          onSelect={(v) => updateCarForm('engine_capacity', v)}
          placeholder="Select Engine Capacity"
        />

        <Text style={styles.fieldLabel}>Steering Side *</Text>
        <Picker
          value={carForm.steering_side}
          options={['', ...STEERING_SIDES]}
          onSelect={(v) => updateCarForm('steering_side', v)}
          placeholder="Select Steering Side"
        />

        <Text style={styles.fieldLabel}>Exterior Color *</Text>
        <Picker
          value={carForm.color}
          options={['', ...EXTERIOR_COLOR_OPTIONS]}
          onSelect={(v) => updateCarForm('color', v)}
          placeholder="Select Color"
        />

        <Text style={styles.fieldLabel}>Interior Color</Text>
        <Picker
          value={carForm.interior_color}
          options={['', ...INTERIOR_COLOR_OPTIONS]}
          onSelect={(v) => updateCarForm('interior_color', v)}
          placeholder="Select Interior Color"
        />

        <Text style={styles.fieldLabel}>Cylinders *</Text>
        <Picker
          value={carForm.cylinders}
          options={['', ...CYLINDER_OPTIONS]}
          onSelect={(v) => updateCarForm('cylinders', v)}
          placeholder="Select Cylinders"
        />

        <Text style={styles.fieldLabel}>Doors *</Text>
        <Picker
          value={carForm.doors}
          options={['', ...DOOR_OPTIONS]}
          onSelect={(v) => updateCarForm('doors', v)}
          placeholder="Select Doors"
        />

        <Text style={styles.fieldLabel}>Warranty *</Text>
        <Picker
          value={carForm.warranty}
          options={['', ...WARRANTY_OPTIONS]}
          onSelect={(v) => updateCarForm('warranty', v)}
          placeholder="Select Warranty"
        />

        <Text style={styles.fieldLabel}>Service History *</Text>
        <Picker
          value={carForm.service_history}
          options={['', ...SERVICE_HISTORY_OPTIONS]}
          onSelect={(v) => updateCarForm('service_history', v)}
          placeholder="Select Service History"
        />

        <Input
          label="VIN *"
          value={carForm.vin_number}
          onChangeText={(v) => updateCarForm('vin_number', v.toUpperCase().slice(0, 17))}
          placeholder="e.g. 1HGCM82633A123456"
          style={{ textTransform: 'uppercase' }}
        />

        <Text style={styles.fieldLabel}>Drivetrain</Text>
        <Picker
          value={carForm.drivetrain}
          options={['', 'FWD', 'RWD', 'AWD', '4WD']}
          onSelect={(v) => updateCarForm('drivetrain', v)}
          placeholder="Select Drivetrain"
        />

        <Input
          label="Fuel Efficiency (km/l)"
          value={carForm.fuel_efficiency}
          onChangeText={(v) => updateCarForm('fuel_efficiency', v)}
          placeholder="e.g. 15"
          keyboardType="numeric"
        />

        <Input
          label="Top Speed (km/h)"
          value={carForm.top_speed}
          onChangeText={(v) => updateCarForm('top_speed', v)}
          placeholder="e.g. 250"
          keyboardType="numeric"
        />

        <Input
          label="0-100 km/h (seconds)"
          value={carForm.zero_to_hundred}
          onChangeText={(v) => updateCarForm('zero_to_hundred', v)}
          placeholder="e.g. 5.5"
          keyboardType="numeric"
        />

        <Input
          label="Torque (Nm)"
          value={carForm.torque}
          onChangeText={(v) => updateCarForm('torque', v)}
          placeholder="e.g. 500"
          keyboardType="numeric"
        />
      </CollapsibleSection>

      <CollapsibleSection title="Extra Features" expanded={expandedSections.car_extras} onToggle={() => toggleSection('car_extras')} hidden={!isSectionVisible('car_extras')}>
        {Object.entries(CAR_EXTRAS).map(([cat, extras]) => (
          <View key={cat} style={styles.extrasCategory}>
            <Text style={styles.extrasCategoryTitle}>{cat}</Text>
            {extras.map((extra) => (
              <ToggleRow
                key={extra}
                label={extra}
                value={carForm.extras.includes(extra)}
                onValueChange={() => toggleCarExtra(extra)}
              />
            ))}
          </View>
        ))}
      </CollapsibleSection>

      <CollapsibleSection title="Location" expanded={expandedSections.car_location} onToggle={() => toggleSection('car_location')} hidden={!isSectionVisible('car_location')}>
        <TouchableOpacity
          style={styles.locationPickerTrigger}
          onPress={() => setShowMapPicker(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="location" size={20} color={COLORS.accent} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={[styles.pickerText, !carEmirate && { color: COLORS.textMuted }]}>
              {carEmirate ? `${carEmirate}${carArea ? `, ${carArea}` : ''}` : 'Tap to set location'}
            </Text>
            {selectedLocation && (
              <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 2 }}>
                {selectedLocation.latitude.toFixed(4)}, {selectedLocation.longitude.toFixed(4)}
              </Text>
            )}
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
        </TouchableOpacity>

        <Input
          label="Car Location"
          value={carForm.car_location}
          onChangeText={(v) => updateCarForm('car_location', v)}
          placeholder="Search for an address in UAE..."
        />
      </CollapsibleSection>

      <CollapsibleSection title="Images" expanded={expandedSections.car_images} onToggle={() => toggleSection('car_images')} hidden={!isSectionVisible('car_images')}>
        <ImageSection images={images} onPickImages={pickImages} onRemoveImage={removeImage} onReorderImages={reorderImages} />
      </CollapsibleSection>
    </View>
  );

  // ==================== BIKE FORM ====================
  const renderBikeForm = () => (
    <View>
      <CollapsibleSection title="Bike Details" expanded={expandedSections.bike_details} onToggle={() => toggleSection('bike_details')} hidden={!isSectionVisible('bike_details')}>
        <Text style={styles.fieldLabel}>Brand *</Text>
        <Picker
          value={bikeForm.bike_brand}
          options={['', ...BIKE_BRANDS]}
          onSelect={(v) => updateBikeForm('bike_brand', v)}
          placeholder="Select Brand"
        />

        <Input
          label="Model *"
          value={bikeForm.bike_model}
          onChangeText={(v) => updateBikeForm('bike_model', v)}
          placeholder="e.g. CBR600RR"
        />

        <Text style={styles.fieldLabel}>Type *</Text>
        <Picker
          value={bikeForm.bike_category}
          options={['', ...BIKE_TYPES]}
          onSelect={(v) => updateBikeForm('bike_category', v)}
          placeholder="Select Type"
        />

        <Input
          label="Engine Size (cc)"
          value={bikeForm.engine_capacity}
          onChangeText={(v) => updateBikeForm('engine_capacity', v)}
          placeholder="e.g. 600"
          keyboardType="numeric"
        />

        <Text style={styles.fieldLabel}>Year *</Text>
        <Picker
          value={bikeForm.year}
          options={['', ...years]}
          onSelect={(v) => updateBikeForm('year', v)}
          placeholder="Select Year"
        />

        <Input
          label="Mileage (km)"
          value={bikeForm.mileage}
          onChangeText={(v) => updateBikeForm('mileage', v)}
          placeholder="e.g. 15000"
          keyboardType="numeric"
        />

        <Input
          label="Color *"
          value={bikeForm.color}
          onChangeText={(v) => updateBikeForm('color', v)}
          placeholder="e.g. Matte Black"
        />

        <Text style={styles.fieldLabel}>Condition</Text>
        <Picker
          value={bikeForm.condition}
          options={['Good', 'Used', 'New', 'Like New', 'Project/Needs Work']}
          onSelect={(v) => updateBikeForm('condition', v)}
        />

        <Input
          label="Price (AED) *"
          value={bikeForm.price}
          onChangeText={(v) => updateBikeForm('price', v)}
          placeholder="e.g. 35000"
          keyboardType="numeric"
        />

        <Input
          label="VIN"
          value={bikeForm.vin_number}
          onChangeText={(v) => updateBikeForm('vin_number', v.toUpperCase().slice(0, 17))}
          placeholder="17-character VIN"
        />

        <TouchableOpacity
          style={styles.scanButton}
          onPress={() => runRegistrationDocScan({
            setStatus: setBikeOcrStatus,
            updateForm: updateBikeForm,
            fieldName: 'vin_number',
            pattern: /\b[A-HJ-NPR-Z0-9]{17}\b/,
          })}
        >
          <Ionicons name="scan-outline" size={20} color={COLORS.accent} />
          <Text style={styles.scanButtonText}>
            {bikeOcrStatus === 'scanning' ? 'Scanning…' : 'Scan mulkiyya for VIN'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.scanDisclaimer}>
          Scanned text may be inaccurate — please double-check before submitting. Uploaded documents may be retained to improve this scanner (see our Privacy Policy).
        </Text>
        {bikeOcrStatus === 'done' && <Text style={styles.scanResultMeta}>VIN found and filled in — please double-check it.</Text>}
        {bikeOcrStatus === 'not-found' && <Text style={styles.scanResultMeta}>No VIN found, enter it manually.</Text>}
        {bikeOcrStatus === 'service-error' && <Text style={styles.scanResultMeta}>Scan failed, try again.</Text>}

        <Text style={styles.fieldLabel}>Cylinders</Text>
        <Picker
          value={bikeForm.cylinders}
          options={['', ...CYLINDER_OPTIONS]}
          onSelect={(v) => updateBikeForm('cylinders', v)}
          placeholder="Select Cylinders"
        />

        <Text style={styles.fieldLabel}>Wheels</Text>
        <Picker
          value={bikeForm.wheels}
          options={['', '2', '3']}
          onSelect={(v) => updateBikeForm('wheels', v)}
          placeholder="Select Wheels"
        />
      </CollapsibleSection>

      <CollapsibleSection title="Contact & Location" expanded={expandedSections.bike_contact} onToggle={() => toggleSection('bike_contact')} hidden={!isSectionVisible('bike_contact')}>
        <Text style={styles.fieldLabel}>Emirate *</Text>
        <Picker
          value={bikeEmirate}
          options={UAE_EMIRATES}
          onSelect={setBikeEmirate}
          placeholder="Select Emirate"
        />

        {bikeAreaOptions.length > 0 ? (
          <Picker
            label="Area *"
            value={bikeArea}
            options={bikeAreaOptions}
            onSelect={setBikeArea}
            placeholder="Select Area"
          />
        ) : (
          <Input
            label="Area *"
            value={bikeArea}
            onChangeText={setBikeArea}
            placeholder="Area"
          />
        )}

        <PhoneInput
          countryCodeLabel="Country Code"
          countryCode={bikeForm.country_code}
          onCountryCodeChange={(v) => updateBikeForm('country_code', v)}
          phoneValue={bikeForm.contact_number}
          onPhoneChange={(v) => updateBikeForm('contact_number', v)}
          required
        />

        <ToggleRow
          label="Dealer Listing"
          value={bikeForm.is_dealer}
          onValueChange={(v) => updateBikeForm('is_dealer', v)}
        />

        <ToggleRow
          label="WhatsApp same as phone"
          value={bikeForm.same_as_phone}
          onValueChange={(v) => {
            updateBikeForm('same_as_phone', v);
            if (v) updateBikeForm('whatsapp_number', '');
          }}
        />
        {!bikeForm.same_as_phone && (
          <PhoneInput
            countryCodeLabel="WhatsApp Code"
            countryCode={bikeForm.country_code}
            onCountryCodeChange={(v) => updateBikeForm('country_code', v)}
            phoneValue={bikeForm.whatsapp_number}
            onPhoneChange={(v) => updateBikeForm('whatsapp_number', v)}
          />
        )}

        <Input
          label="Description *"
          value={bikeForm.description}
          onChangeText={(v) => updateBikeForm('description', v)}
          placeholder="Describe your bike..."
          multiline
        />
      </CollapsibleSection>

      <CollapsibleSection title="Images" expanded={expandedSections.bike_images} onToggle={() => toggleSection('bike_images')} hidden={!isSectionVisible('bike_images')}>
        <ImageSection images={images} onPickImages={pickImages} onRemoveImage={removeImage} onReorderImages={reorderImages} />
      </CollapsibleSection>
    </View>
  );

  // ==================== PLATE FORM ====================
  const renderPlateForm = () => (
    <View>
      <CollapsibleSection title="Plate Details" expanded={expandedSections.plate_details} onToggle={() => toggleSection('plate_details')} hidden={!isSectionVisible('plate_details')}>
        <Text style={styles.fieldLabel}>City *</Text>
        <Picker
          value={plateCity}
          options={PLATE_CITIES}
          onSelect={setPlateCity}
          placeholder="Select City"
        />

        <Text style={styles.fieldLabel}>Code *</Text>
        <Picker
          value={plateForm.code}
          options={['', ...getCodeOptions(plateCityName)]}
          onSelect={(v) => updatePlateForm('code', v)}
          placeholder={plateCityName ? 'Select Code' : 'Select City first'}
        />

        <Input
          label="Number *"
          value={plateForm.number}
          onChangeText={(v) => updatePlateForm('number', v.replace(/\D/g, '').slice(0, 5))}
          placeholder="e.g. 12345"
          keyboardType="numeric"
        />

        <TouchableOpacity
          style={styles.scanButton}
          onPress={() => runRegistrationDocScan({
            setStatus: setPlateOcrStatus,
            updateForm: updatePlateForm,
            fieldName: 'number',
            pattern: /\b(\d{1,5})\b/,
          })}
        >
          <Ionicons name="scan-outline" size={20} color={COLORS.accent} />
          <Text style={styles.scanButtonText}>
            {plateOcrStatus === 'scanning' ? 'Scanning…' : 'Scan registration for plate number'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.scanDisclaimer}>
          Scanned text may be inaccurate — please double-check before submitting. Uploaded documents may be retained to improve this scanner (see our Privacy Policy).
        </Text>
        {plateOcrStatus === 'done' && <Text style={styles.scanResultMeta}>Plate number found and filled in — please double-check it.</Text>}
        {plateOcrStatus === 'not-found' && <Text style={styles.scanResultMeta}>No number found, enter it manually.</Text>}
        {plateOcrStatus === 'service-error' && <Text style={styles.scanResultMeta}>Scan failed, try again.</Text>}

        <Input
          label="Digits"
          value={plateForm.digits}
          onChangeText={(v) => updatePlateForm('digits', v)}
          placeholder="Number of digits"
          keyboardType="numeric"
        />

        <Text style={styles.fieldLabel}>Format</Text>
        <Picker
          value={plateForm.plate_format}
          options={PLATE_FORMATS}
          onSelect={(v) => updatePlateForm('plate_format', v)}
          placeholder="Select Format"
        />

        <Input
          label="Price (AED) *"
          value={plateForm.price}
          onChangeText={(v) => updatePlateForm('price', v)}
          placeholder="e.g. 15000"
          keyboardType="numeric"
        />

        <Input
          label="Description"
          value={plateForm.description}
          onChangeText={(v) => updatePlateForm('description', v)}
          placeholder="Describe your plate..."
          multiline
        />
      </CollapsibleSection>

      <CollapsibleSection title="Contact & Location" expanded={expandedSections.plate_contact} onToggle={() => toggleSection('plate_contact')} hidden={!isSectionVisible('plate_contact')}>
        {plateAreaOptions.length > 0 ? (
          <Picker
            label="Area *"
            value={plateArea}
            options={plateAreaOptions}
            onSelect={setPlateArea}
            placeholder="Select Area"
          />
        ) : (
          <Input
            label="Area *"
            value={plateArea}
            onChangeText={setPlateArea}
            placeholder="Area"
          />
        )}

        <PhoneInput
          countryCodeLabel="Country Code"
          countryCode={plateForm.country_code}
          onCountryCodeChange={(v) => updatePlateForm('country_code', v)}
          phoneValue={plateForm.contact_phone}
          onPhoneChange={(v) => updatePlateForm('contact_phone', v)}
          required
        />

        <ToggleRow
          label="Dealer Listing"
          value={plateForm.is_dealer}
          onValueChange={(v) => updatePlateForm('is_dealer', v)}
        />

        <ToggleRow
          label="WhatsApp same as phone"
          value={plateForm.same_as_phone}
          onValueChange={(v) => {
            updatePlateForm('same_as_phone', v);
            if (v) updatePlateForm('whatsapp_number', '');
          }}
        />
        {!plateForm.same_as_phone && (
          <PhoneInput
            countryCodeLabel="WhatsApp Code"
            countryCode={plateForm.country_code}
            onCountryCodeChange={(v) => updatePlateForm('country_code', v)}
            phoneValue={plateForm.whatsapp_number}
            onPhoneChange={(v) => updatePlateForm('whatsapp_number', v)}
          />
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Images" expanded={expandedSections.plate_images} onToggle={() => toggleSection('plate_images')} hidden={!isSectionVisible('plate_images')}>
        <ImageSection images={images} onPickImages={pickImages} onRemoveImage={removeImage} onReorderImages={reorderImages} />
      </CollapsibleSection>
    </View>
  );

  // ==================== PARTS FORM ====================
  const renderPartsForm = () => (
    <View>
      <CollapsibleSection title="Part Details" expanded={expandedSections.parts_details} onToggle={() => toggleSection('parts_details')} hidden={!isSectionVisible('parts_details')}>
        <Input
          label="Part Name *"
          value={partsForm.name}
          onChangeText={(v) => updatePartsForm('name', v)}
          placeholder="e.g. OEM LED Headlight Assembly"
        />

        <Text style={styles.fieldLabel}>Part Type *</Text>
        <Picker
          value={partsForm.part_type}
          options={['', ...PART_TYPES]}
          onSelect={(v) => updatePartsForm('part_type', v)}
          placeholder="Select Part Type"
        />

        <Text style={styles.fieldLabel}>Condition</Text>
        <Picker
          value={partsForm.condition}
          options={PART_CONDITIONS}
          onSelect={(v) => updatePartsForm('condition', v)}
          placeholder="Select Condition"
        />

        <Input
          label="Price (AED) *"
          value={partsForm.price}
          onChangeText={(v) => updatePartsForm('price', v)}
          placeholder="e.g. 850"
          keyboardType="numeric"
        />

        <Input
          label="Description"
          value={partsForm.description}
          onChangeText={(v) => updatePartsForm('description', v)}
          placeholder="Describe the part..."
          multiline
        />

        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Negotiable Price</Text>
          <Switch
            value={partsForm.is_negotiable}
            onValueChange={(v) => updatePartsForm('is_negotiable', v)}
            trackColor={{ false: COLORS.surfaceHigher, true: COLORS.primaryLight }}
            thumbColor={partsForm.is_negotiable ? COLORS.accent : COLORS.textMuted}
          />
        </View>
      </CollapsibleSection>

      <CollapsibleSection title="Compatibility" expanded={expandedSections.parts_compatibility} onToggle={() => toggleSection('parts_compatibility')} hidden={!isSectionVisible('parts_compatibility')}>
        <Input
          label="Compatible Makes"
          value={partsForm.compatible_makes}
          onChangeText={(v) => updatePartsForm('compatible_makes', v)}
          placeholder="BMW, Toyota, Porsche (comma-separated)"
        />

        <Input
          label="Compatible Models"
          value={partsForm.compatible_models}
          onChangeText={(v) => updatePartsForm('compatible_models', v)}
          placeholder="X5, Camry, Cayenne (comma-separated)"
        />

        <Text style={styles.fieldLabel}>Compatible Years</Text>
        <Picker
          value={partsForm.compatible_years}
          options={['', ...years.slice(0, 20)]}
          onSelect={(v) => updatePartsForm('compatible_years', v)}
          placeholder="Select Year"
        />
      </CollapsibleSection>

      <CollapsibleSection title="Contact & Location" expanded={expandedSections.parts_contact} onToggle={() => toggleSection('parts_contact')} hidden={!isSectionVisible('parts_contact')}>
        <Text style={styles.fieldLabel}>Emirate *</Text>
        <Picker
          value={partsEmirate}
          options={UAE_EMIRATES}
          onSelect={setPartsEmirate}
          placeholder="Select Emirate"
        />

        {partsAreaOptions.length > 0 ? (
          <Picker
            label="Area *"
            value={partsArea}
            options={partsAreaOptions}
            onSelect={setPartsArea}
            placeholder="Select Area"
          />
        ) : (
          <Input
            label="Area *"
            value={partsArea}
            onChangeText={setPartsArea}
            placeholder="Area"
          />
        )}

        <PhoneInput
          countryCodeLabel="Country Code"
          countryCode={partsForm.country_code}
          onCountryCodeChange={(v) => updatePartsForm('country_code', v)}
          phoneValue={partsForm.contact_number}
          onPhoneChange={(v) => updatePartsForm('contact_number', v)}
          required
        />

        <ToggleRow
          label="Dealer Listing"
          value={partsForm.is_dealer}
          onValueChange={(v) => updatePartsForm('is_dealer', v)}
        />

        <ToggleRow
          label="WhatsApp same as phone"
          value={partsForm.same_as_phone}
          onValueChange={(v) => {
            updatePartsForm('same_as_phone', v);
            if (v) updatePartsForm('whatsapp_number', '');
          }}
        />
        {!partsForm.same_as_phone && (
          <PhoneInput
            countryCodeLabel="WhatsApp Code"
            countryCode={partsForm.country_code}
            onCountryCodeChange={(v) => updatePartsForm('country_code', v)}
            phoneValue={partsForm.whatsapp_number}
            onPhoneChange={(v) => updatePartsForm('whatsapp_number', v)}
          />
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Images" expanded={expandedSections.parts_images} onToggle={() => toggleSection('parts_images')} hidden={!isSectionVisible('parts_images')}>
        <ImageSection images={images} onPickImages={pickImages} onRemoveImage={removeImage} onReorderImages={reorderImages} />
      </CollapsibleSection>
    </View>
  );

  // ==================== MAP PICKER MODAL ====================
  const renderMapPickerModal = () => (
    <Modal visible={showMapPicker} animationType="slide" onRequestClose={() => setShowMapPicker(false)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.black }}>
        <View style={styles.mapPickerHeader}>
          <TouchableOpacity onPress={() => setShowMapPicker(false)}>
            <Text style={{ color: COLORS.accent, fontSize: FONT_SIZES.md }}>Cancel</Text>
          </TouchableOpacity>
          <Text style={{ color: COLORS.white, fontWeight: '700', fontSize: FONT_SIZES.lg }}>Set Location</Text>
          <TouchableOpacity onPress={() => setShowMapPicker(false)}>
            <Text style={{ color: COLORS.accent, fontSize: FONT_SIZES.md }}>Confirm</Text>
          </TouchableOpacity>
        </View>

        <MapView
          style={{ flex: 1 }}
          initialRegion={{
            latitude: selectedLocation?.latitude || 25.276987,
            longitude: selectedLocation?.longitude || 55.296249,
            latitudeDelta: 0.5,
            longitudeDelta: 0.5,
          }}
          region={selectedLocation ? {
            latitude: selectedLocation.latitude,
            longitude: selectedLocation.longitude,
            latitudeDelta: 0.5,
            longitudeDelta: 0.5,
          } : undefined}
        >
          <Marker
            coordinate={{
              latitude: selectedLocation?.latitude || 25.276987,
              longitude: selectedLocation?.longitude || 55.296249,
            }}
            draggable
            onDragEnd={(e) => {
              setSelectedLocation({
                ...selectedLocation,
                latitude: e.nativeEvent.coordinate.latitude,
                longitude: e.nativeEvent.coordinate.longitude,
              });
            }}
          />
        </MapView>

        <View style={styles.mapPickerControls}>
          <TouchableOpacity style={styles.useLocationBtn} onPress={useMyLocation}>
            <Ionicons name="navigate" size={18} color={COLORS.accent} />
            <Text style={styles.useLocationBtnText}>Use My Location</Text>
          </TouchableOpacity>

          <View style={{ marginTop: 12 }}>
            <Text style={styles.fieldLabel}>Emirate *</Text>
            <Picker
              value={carEmirate}
              options={UAE_EMIRATES}
              onSelect={setCarEmirate}
              placeholder="Select Emirate"
            />
            {carAreaOptions.length > 0 ? (
              <Picker
                label="Area"
                value={carArea}
                options={carAreaOptions}
                onSelect={setCarArea}
                placeholder="Select Area"
              />
            ) : (
              <Input
                label="Area"
                value={carArea}
                onChangeText={setCarArea}
                placeholder="Area"
              />
            )}
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );

  // ==================== MAIN FORM VIEW ====================
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {renderMapPickerModal()}
      <ImageCropperModal
        visible={cropperVisible}
        imageUri={cropperUri}
        onConfirm={async (uri) => {
          // ponytail: moderate after crop so we check the final image, not the raw picker URI
          let allow = true;
          setModerating(true);
          try {
            const r = await moderateImage(uri);
            if (r.blocked) {
              const reason = r.reasons.includes('nudity')
                ? 'Explicit content is not allowed.'
                : 'Faces detected — please use vehicle-only photos.';
              Alert.alert('Photo Blocked', reason);
              allow = false;
            }
          } catch {
            // ponytail: fail-open on moderation error
          }
          setModerating(false);
          setCropperVisible(false);
          setCropperUri(null);
          if (allow) setImages(prev => [...prev, uri]);
        }}
        onCancel={() => {
          setCropperVisible(false);
          setCropperUri(null);
        }}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.formHeader}>
          <TouchableOpacity onPress={resetAndGoBack}>
            <Ionicons name="arrow-back" size={24} color={COLORS.white} />
          </TouchableOpacity>
          <Text style={styles.formHeaderTitle}>
            {isEditMode ? 'Edit' : 'Post'} {CATEGORIES.find(c => c.key === category)?.label}
          </Text>
          {lastDraftSave && (
            <Text style={styles.draftIndicator}>Draft saved</Text>
          )}
          <View style={{ width: 24 }} />
        </View>
        {!isEditMode && (
          <View style={styles.stepRow}>
            {[1, 2, 3].map((n) => (
              <View
                key={n}
                style={[
                  styles.stepDot,
                  n === wizardStep && styles.stepDotActive,
                  n < wizardStep && styles.stepDotDone,
                ]}
              />
            ))}
            <Text style={styles.stepLabel}>
              {wizardStep === 1 && 'Step 1 of 3 · Photos'}
              {wizardStep === 2 && 'Step 2 of 3 · Essentials'}
              {wizardStep === 3 && 'Step 3 of 3 · Details & review'}
            </Text>
          </View>
        )}
        <ScrollView
          contentContainerStyle={styles.formContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {category === 'car' && renderCarForm()}
          {category === 'bike' && renderBikeForm()}
          {category === 'plate' && renderPlateForm()}
          {category === 'parts' && renderPartsForm()}

          {(isEditMode || wizardStep === 3) && (
            <Button
              title={isEditMode ? 'Update Listing' : 'Post Listing'}
              onPress={handleSubmit}
              loading={loading}
              disabled={moderating}
              style={styles.submitBtn}
            />
          )}
          {!isEditMode && wizardStep < 3 && (
            <View style={styles.wizardNavRow}>
              {wizardStep > 1 && (
                <TouchableOpacity
                  style={[styles.wizardNavBtn, styles.wizardNavBtnSecondary]}
                  onPress={() => setWizardStep((s) => Math.max(1, s - 1))}
                  activeOpacity={0.7}
                >
                  <Text style={styles.wizardNavBtnSecondaryText}>Back</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[
                  styles.wizardNavBtn,
                  styles.wizardNavBtnPrimary,
                  wizardStep === 1 && images.length === 0 && styles.wizardNavBtnDisabled,
                ]}
                disabled={wizardStep === 1 && images.length === 0}
                onPress={() => setWizardStep((s) => Math.min(3, s + 1))}
                activeOpacity={0.7}
              >
                <Text style={styles.wizardNavBtnPrimaryText}>Continue</Text>
                <Ionicons name="arrow-forward" size={16} color={COLORS.white} />
              </TouchableOpacity>
            </View>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: SPACING.md },
  headerTitle: { color: COLORS.white, fontSize: FONT_SIZES.xxl, fontWeight: '700' },
  headerSubtitle: { color: COLORS.textSecondary, fontSize: FONT_SIZES.md, marginTop: 4 },
  categoryGrid: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between',
    padding: SPACING.md, gap: 12,
  },
  categoryCard: {
    width: '47%', backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg,
    paddingVertical: 32, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.border,
  },
  categoryLabel: { color: COLORS.white, fontSize: FONT_SIZES.lg, fontWeight: '600', marginTop: 12 },
  formHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
  },
  formHeaderTitle: { color: COLORS.white, fontSize: FONT_SIZES.lg, fontWeight: '600' },
  stepRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: SPACING.md, paddingBottom: SPACING.sm,
  },
  stepDot: { width: 24, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)' },
  stepDotActive: { backgroundColor: COLORS.accent },
  stepDotDone: { backgroundColor: 'rgba(76,175,80,0.6)' },
  stepLabel: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, fontWeight: '600', marginLeft: 8 },
  wizardNavRow: {
    flexDirection: 'row', gap: 10, marginTop: SPACING.lg, paddingHorizontal: SPACING.md,
  },
  wizardNavBtn: {
    flex: 1, paddingVertical: 14, borderRadius: BORDER_RADIUS.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    minHeight: 48,
  },
  wizardNavBtnPrimary: { backgroundColor: COLORS.accent },
  wizardNavBtnSecondary: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  wizardNavBtnDisabled: { opacity: 0.4 },
  wizardNavBtnPrimaryText: { color: COLORS.white, fontWeight: '700', fontSize: FONT_SIZES.md },
  wizardNavBtnSecondaryText: { color: COLORS.white, fontWeight: '600', fontSize: FONT_SIZES.md },
  formContent: { paddingHorizontal: SPACING.md, paddingTop: SPACING.sm },
  section: { marginBottom: 8 },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: 14,
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.md,
    marginBottom: 2,
  },
  sectionTitle: { color: COLORS.white, fontSize: FONT_SIZES.lg, fontWeight: '600' },
  sectionContent: { paddingTop: 12 },
  fieldLabel: {
    color: COLORS.textSecondary, fontSize: FONT_SIZES.sm,
    marginBottom: 6, fontWeight: '500',
  },
  charCounter: {
    color: COLORS.textMuted, fontSize: FONT_SIZES.xs,
    marginBottom: 4, textAlign: 'right',
  },
  pickerContainer: { marginBottom: 16 },
  pickerLabel: {
    color: COLORS.textSecondary, fontSize: FONT_SIZES.sm,
    marginBottom: 6, fontWeight: '500',
  },
  pickerTrigger: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: COLORS.surfaceHigher, borderRadius: BORDER_RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 14, paddingVertical: 12,
  },
  pickerText: { color: COLORS.white, fontSize: FONT_SIZES.md, flex: 1 },
  phoneRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  codePickerContainer: { width: 100 },
  codePickerTrigger: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: COLORS.surfaceHigher, borderRadius: BORDER_RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 10, paddingVertical: 12,
  },
  phoneInputContainer: { flex: 1 },
  toggleRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: COLORS.borderLight,
  },
  toggleLabel: { color: COLORS.white, fontSize: FONT_SIZES.md },
  extrasCategory: { marginBottom: 16 },
  extrasCategoryTitle: {
    color: COLORS.accent, fontSize: FONT_SIZES.sm, fontWeight: '700',
    textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.5,
  },
  submitBtn: { marginTop: 8 },
  imageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  imageCount: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  imageScroll: {
    marginTop: 4,
  },
  imageThumb: {
    width: 96, height: 96, borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden', marginRight: 10, position: 'relative',
    backgroundColor: COLORS.surfaceHigher,
  },
  imageThumbImage: {
    width: '100%',
    height: '100%',
  },
  imageCoverBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: 'rgba(76,175,80,0.95)',
  },
  imageCoverText: {
    color: COLORS.white,
    fontSize: 9,
    fontWeight: '700',
  },
  imageRemove: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 12,
  },
  imageReorderLeft: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  imageReorderRight: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  addImageBtn: {
    width: 96, height: 96, borderRadius: BORDER_RADIUS.md,
    borderWidth: 1.5, borderColor: COLORS.accent, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(76,175,80,0.06)',
  },
  addImageText: { color: COLORS.accent, fontSize: FONT_SIZES.xs, marginTop: 4, fontWeight: '600' },
  emptyAddImage: {
    borderWidth: 1.5,
    borderColor: COLORS.accent,
    borderStyle: 'dashed',
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.xl,
    paddingHorizontal: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(76,175,80,0.06)',
  },
  emptyAddImageTitle: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
    marginTop: 8,
  },
  emptyAddImageSubtitle: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    marginTop: 4,
    textAlign: 'center',
  },
  imageHint: {
    marginTop: 8,
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.surfaceHigher,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.accent,
    borderStyle: 'dashed',
    paddingVertical: 12,
    marginBottom: SPACING.md,
  },
  scanButtonText: {
    color: COLORS.accent,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  scanResultCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    gap: 6,
  },
  scanResultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  scanResultTitle: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
  },
  scanResultBadge: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  scanResultBadgeVerified: {
    color: COLORS.accent,
    backgroundColor: 'rgba(39, 174, 96, 0.18)',
  },
  scanResultBadgeReview: {
    color: '#f59e0b',
    backgroundColor: 'rgba(245, 158, 11, 0.18)',
  },
  scanResultLine: {
    color: COLORS.white,
    fontSize: FONT_SIZES.sm,
  },
  scanResultMeta: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.xs,
  },
  scanDisclaimer: {
    color: COLORS.warning,
    fontSize: FONT_SIZES.xs,
    marginTop: 6,
    marginBottom: 4,
  },
  locationPickerTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceHigher,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 12,
  },
  mapPickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.md,
  },
  mapPickerControls: {
    padding: SPACING.md,
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
  },
  useLocationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.surfaceHigher,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.accent,
    paddingVertical: 12,
  },
  useLocationBtnText: {
    color: COLORS.accent,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  draftIndicator: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    fontStyle: 'italic',
  },
});
