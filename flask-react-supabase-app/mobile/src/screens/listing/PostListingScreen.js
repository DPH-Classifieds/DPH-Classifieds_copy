import React, { useState, useCallback, useEffect, useRef } from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import apiClient from '../../utils/apiClient';
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
  CAR_EXTRAS,
  getYearOptions,
  UAE_EMIRATES,
  getAreasForEmirate,
} from '../../utils/listingConstants';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';

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
          <FlatList
            data={options}
            renderItem={renderItem}
            keyExtractor={(item, i) => {
              const label = typeof item === 'object' ? item.name || item.label : item;
              return `${label}-${i}`;
            }}
            ItemSeparatorComponent={() => <View style={pickerStyles.separator} />}
            contentContainerStyle={pickerStyles.listContent}
            keyboardShouldPersistTaps="handled"
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

function CollapsibleSection({ title, expanded, onToggle, children }) {
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

function ImageSection({ images, onPickImages, onRemoveImage }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Photos ({images.length}/10)</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageScroll}>
        {images.map((uri, i) => (
          <View key={i} style={styles.imageThumb}>
            <View style={styles.imageThumbPlaceholder}>
              <Ionicons name="image" size={20} color="rgba(255,255,255,0.3)" />
            </View>
            <TouchableOpacity style={styles.imageRemove} onPress={() => onRemoveImage(i)}>
              <Ionicons name="close-circle" size={20} color={COLORS.error} />
            </TouchableOpacity>
          </View>
        ))}
        {images.length < 10 && (
          <TouchableOpacity style={styles.addImageBtn} onPress={onPickImages}>
            <Ionicons name="camera-outline" size={28} color={COLORS.textMuted} />
            <Text style={styles.addImageText}>Add</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
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

  const [carEmirate, setCarEmirate] = useState('Dubai');
  const [carArea, setCarArea] = useState('');
  const [titleManuallyEdited, setTitleManuallyEdited] = useState(false);

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
  });

  const [partsEmirate, setPartsEmirate] = useState('Dubai');
  const [partsArea, setPartsArea] = useState('');

  const [partsForm, setPartsForm] = useState({
    name: '',
    part_type: '',
    condition: 'New',
    compatible_makes: '',
    compatible_models: '',
    price: '',
    description: '',
    contact_number: '',
    country_code: '+971',
    is_negotiable: false,
  });

  const [expandedSections, setExpandedSections] = useState({
    car_basic: true,
    car_specs: false,
    car_extras: false,
    car_location: false,
    car_images: false,
    bike_details: true,
    bike_specs: false,
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

  const pickImages = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 10 - images.length,
      quality: 0.7,
    });
    if (!result.canceled && result.assets) {
      const newImages = result.assets.map(a => a.uri);
      setImages(prev => [...prev, ...newImages].slice(0, 10));
    }
  }, [images.length]);

  const removeImage = (index) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const updateCarForm = (key, value) => setCarForm(prev => ({ ...prev, [key]: value }));
  const updateBikeForm = (key, value) => setBikeForm(prev => ({ ...prev, [key]: value }));
  const updatePlateForm = (key, value) => setPlateForm(prev => ({ ...prev, [key]: value }));
  const updatePartsForm = (key, value) => setPartsForm(prev => ({ ...prev, [key]: value }));

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
          price: String(data.price || ''),
          description: data.description || '',
          contact_number: data.contact_number || '',
          country_code: data.country_code || '+971',
          is_negotiable: data.is_negotiable || false,
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

  const buildFormData = (form, imageUris) => {
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => {
      if (typeof v === 'boolean') fd.append(k, String(v));
      else if (Array.isArray(v)) fd.append(k, JSON.stringify(v));
      else if (v !== '' && v !== null && v !== undefined) fd.append(k, String(v));
    });
    imageUris.forEach((uri, i) => {
      const ext = uri.split('.').pop() || 'jpg';
      fd.append('images', { uri, type: `image/${ext}`, name: `image_${i}.${ext}` });
    });
    return fd;
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
      let fd;
      let endpoint;

      if (isEditMode) {
        const endpointMap = { car: 'cars', bike: 'bikes', plate: 'plates', parts: 'parts' };
        endpoint = `/api/${endpointMap[listingType]}/${listingId}`;
      }

      if (category === 'car') {
        if (!carForm.car_manufacturer || !carForm.car_model || !carForm.make_year || !carForm.expected_selling_price) {
          Alert.alert('Required', 'Make, Model, Year, and Price are required.');
          setLoading(false);
          return;
        }
        const phone = `${carForm.country_code || '+971'}${carForm.car_owner_phone_number || ''}`.replace(/[^0-9+]/g, '');
        const payload = {
          ...carForm,
          emirate: carEmirate,
          area: carArea,
          car_city: carEmirate,
          latitude: 25.276987,
          longitude: 55.296249,
          whatsapp_number: phone,
          whatsapp_prefill_text: `Hi, I'm interested in your ${carForm.car_manufacturer} ${carForm.car_model} listed on DPH Classifieds for AED ${carForm.expected_selling_price}. Is it still available?`,
        };
        fd = buildFormData(payload, images);
        if (!isEditMode) endpoint = '/api/cars';
      } else if (category === 'bike') {
        if (!bikeForm.bike_brand || !bikeForm.bike_model || !bikeForm.price) {
          Alert.alert('Required', 'Brand, Model, and Price are required.');
          setLoading(false);
          return;
        }
        const phone = `${bikeForm.country_code || '+971'}${bikeForm.contact_number || ''}`.replace(/[^0-9+]/g, '');
        const payload = {
          ...bikeForm,
          bike_type: bikeForm.bike_category,
          engine_size: bikeForm.engine_capacity,
          emirate: bikeEmirate,
          area: bikeArea,
          location: bikeArea,
          whatsapp_number: phone,
          whatsapp_prefill_text: `Hi, I'm interested in your ${bikeForm.bike_brand} ${bikeForm.bike_model} listed on DPH Classifieds for AED ${bikeForm.price}. Is it still available?`,
        };
        fd = buildFormData(payload, images);
        if (!isEditMode) endpoint = '/api/bikes';
      } else if (category === 'plate') {
        if (!plateCityName || !plateForm.price) {
          Alert.alert('Required', 'City and Price are required.');
          setLoading(false);
          return;
        }
        const phone = `${plateForm.country_code || '+971'}${plateForm.contact_phone || ''}`.replace(/[^0-9+]/g, '');
        const payload = {
          ...plateForm,
          city: plateCityName,
          emirate: plateCityName,
          area: plateArea,
          contact_phone: phone,
          whatsapp_number: phone,
          whatsapp_prefill_text: `Hi, I'm interested in your ${plateCityName} plate "${plateForm.code} ${plateForm.number}" listed on DPH Classifieds for AED ${plateForm.price}. Is it still available?`,
        };
        fd = buildFormData(payload, images);
        if (!isEditMode) endpoint = '/api/plates';
      } else if (category === 'parts') {
        if (!partsForm.name || !partsForm.price) {
          Alert.alert('Required', 'Part Name and Price are required.');
          setLoading(false);
          return;
        }
        const phone = `${partsForm.country_code || '+971'}${partsForm.contact_number || ''}`.replace(/[^0-9+]/g, '');
        const payload = {
          ...partsForm,
          emirate: partsEmirate,
          area: partsArea,
          location: partsArea,
          contact_number: phone,
          whatsapp_number: phone,
          whatsapp_prefill_text: `Hi, I'm interested in your "${partsForm.name}" listed on DPH Classifieds for AED ${partsForm.price}. Is it still available?`,
          compatible_makes: partsForm.compatible_makes
            ? partsForm.compatible_makes.split(',').map(s => s.trim()).filter(Boolean)
            : [],
          compatible_models: partsForm.compatible_models
            ? partsForm.compatible_models.split(',').map(s => s.trim()).filter(Boolean)
            : [],
        };
        fd = buildFormData(payload, images);
        if (!isEditMode) endpoint = '/api/parts';
      }

      if (isEditMode) {
        await apiClient.put(endpoint, fd);
      } else {
        await apiClient.post(endpoint, fd);
      }
      Alert.alert('Success', isEditMode ? 'Your listing has been updated!' : 'Your listing has been posted!', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to post listing. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [category, carForm, bikeForm, plateForm, partsForm, images, navigation, carEmirate, carArea, bikeEmirate, bikeArea, plateCityName, plateArea, partsEmirate, partsArea]);

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
      <CollapsibleSection title="Basic Details" expanded={expandedSections.car_basic} onToggle={() => toggleSection('car_basic')}>
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

        <Text style={styles.fieldLabel}>Dealer Listing</Text>
        <Picker
          value={carForm.is_dealer ? 'Dealer' : 'Private Seller'}
          options={['Private Seller', 'Dealer']}
          onSelect={(v) => updateCarForm('is_dealer', v === 'Dealer')}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Specifications" expanded={expandedSections.car_specs} onToggle={() => toggleSection('car_specs')}>
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
      </CollapsibleSection>

      <CollapsibleSection title="Extra Features" expanded={expandedSections.car_extras} onToggle={() => toggleSection('car_extras')}>
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

      <CollapsibleSection title="Location" expanded={expandedSections.car_location} onToggle={() => toggleSection('car_location')}>
        <Input
          label="Car Location"
          value={carForm.car_location}
          onChangeText={(v) => updateCarForm('car_location', v)}
          placeholder="Search for an address in UAE..."
        />
      </CollapsibleSection>

      <CollapsibleSection title="Images" expanded={expandedSections.car_images} onToggle={() => toggleSection('car_images')}>
        <ImageSection images={images} onPickImages={pickImages} onRemoveImage={removeImage} />
      </CollapsibleSection>
    </View>
  );

  // ==================== BIKE FORM ====================
  const renderBikeForm = () => (
    <View>
      <CollapsibleSection title="Bike Details" expanded={expandedSections.bike_details} onToggle={() => toggleSection('bike_details')}>
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
      </CollapsibleSection>

      <CollapsibleSection title="Contact & Location" expanded={expandedSections.bike_contact} onToggle={() => toggleSection('bike_contact')}>
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

        <Input
          label="Description *"
          value={bikeForm.description}
          onChangeText={(v) => updateBikeForm('description', v)}
          placeholder="Describe your bike..."
          multiline
        />
      </CollapsibleSection>

      <CollapsibleSection title="Images" expanded={expandedSections.bike_images} onToggle={() => toggleSection('bike_images')}>
        <ImageSection images={images} onPickImages={pickImages} onRemoveImage={removeImage} />
      </CollapsibleSection>
    </View>
  );

  // ==================== PLATE FORM ====================
  const renderPlateForm = () => (
    <View>
      <CollapsibleSection title="Plate Details" expanded={expandedSections.plate_details} onToggle={() => toggleSection('plate_details')}>
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

      <CollapsibleSection title="Contact & Location" expanded={expandedSections.plate_contact} onToggle={() => toggleSection('plate_contact')}>
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
      </CollapsibleSection>

      <CollapsibleSection title="Images" expanded={expandedSections.plate_images} onToggle={() => toggleSection('plate_images')}>
        <ImageSection images={images} onPickImages={pickImages} onRemoveImage={removeImage} />
      </CollapsibleSection>
    </View>
  );

  // ==================== PARTS FORM ====================
  const renderPartsForm = () => (
    <View>
      <CollapsibleSection title="Part Details" expanded={expandedSections.parts_details} onToggle={() => toggleSection('parts_details')}>
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

      <CollapsibleSection title="Compatibility" expanded={expandedSections.parts_compatibility} onToggle={() => toggleSection('parts_compatibility')}>
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
      </CollapsibleSection>

      <CollapsibleSection title="Contact & Location" expanded={expandedSections.parts_contact} onToggle={() => toggleSection('parts_contact')}>
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
      </CollapsibleSection>

      <CollapsibleSection title="Images" expanded={expandedSections.parts_images} onToggle={() => toggleSection('parts_images')}>
        <ImageSection images={images} onPickImages={pickImages} onRemoveImage={removeImage} />
      </CollapsibleSection>
    </View>
  );

  // ==================== MAIN FORM VIEW ====================
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
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
          <View style={{ width: 24 }} />
        </View>
        <ScrollView
          contentContainerStyle={styles.formContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {category === 'car' && renderCarForm()}
          {category === 'bike' && renderBikeForm()}
          {category === 'plate' && renderPlateForm()}
          {category === 'parts' && renderPartsForm()}

          <Button
            title={isEditMode ? 'Update Listing' : 'Post Listing'}
            onPress={handleSubmit}
            loading={loading}
            style={styles.submitBtn}
          />
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
  imageScroll: { marginBottom: 8 },
  imageThumb: {
    width: 80, height: 80, borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden', marginRight: 10, position: 'relative',
  },
  imageThumbPlaceholder: {
    flex: 1, backgroundColor: COLORS.surfaceHigher,
    alignItems: 'center', justifyContent: 'center',
  },
  imageRemove: { position: 'absolute', top: -4, right: -4 },
  addImageBtn: {
    width: 80, height: 80, borderRadius: BORDER_RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
  },
  addImageText: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 4 },
});
