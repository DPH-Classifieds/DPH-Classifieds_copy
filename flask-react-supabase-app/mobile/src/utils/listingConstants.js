import { carMakes, carModels } from './carData';

export const UAE_EMIRATES = [
  "Abu Dhabi", "Dubai", "Sharjah", "Ajman", "Umm Al Quwain",
  "Ras Al Khaimah", "Fujairah",
];

export const DUBAI_AREAS = [
  "Al Barari", "Al Barsha", "Al Furjan", "Al Garhoud", "Nad Al Hamar",
  "Al Jaddaf", "Al Karama", "Al Khawaneej", "Al Mamzar", "Al Mizhar",
  "Al Nahda", "Al Quoz", "Al Qusais", "Al Safa", "Al Satwa",
  "Al Sufouh", "Al Twar", "Al Wasl", "Al Warqa", "Arabian Ranches",
  "Arabian Ranches 2", "Arabian Ranches 3", "Bluewaters Island",
  "Business Bay", "City Walk", "DAMAC Hills", "DAMAC Hills 2", "DIFC",
  "Discovery Gardens", "Downtown Dubai", "Dubai Creek Harbour",
  "Dubai Festival City", "Dubai Harbour", "Dubai Hills Estate",
  "Dubai Industrial City", "Dubai Investments Park (DIP)",
  "Dubai Marina", "Dubai Silicon Oasis", "Dubai Sports City",
  "Dubai Studio City", "Dubai South", "Dubai Production City",
  "Emaar South", "Emirates Hills", "Expo City Dubai",
  "International City", "Jebel Ali", "JLT (Jumeirah Lake Towers)",
  "Jumeirah", "Jumeirah Beach Residence (JBR)", "Jumeirah Bay Island",
  "Jumeirah Golf Estates", "Jumeirah Islands", "Jumeirah Park",
  "Jumeirah Village Circle (JVC)", "Jumeirah Village Triangle (JVT)",
  "Liwan", "Meydan", "Mohammed Bin Rashid City", "Mirdif", "Motor City",
  "Mudon", "Nad Al Sheba", "Nad Al Hamar", "Al Kifaf",
  "Palm Jumeirah", "Palm Jebel Ali", "Ras Al Khor", "Remraam",
  "Sheikh Zayed Road", "Sobha Hartland", "The Greens", "The Lakes",
  "The Meadows", "The Springs", "The Sustainable City", "The Villa",
  "Tilal Al Ghaf", "Town Square", "Umm Suqeim", "Wadi Al Safa",
  "Za'abeel 1", "Za'abeel 2", "Zabeel", "Zabeel 2", "Zabeel 3",
  "Zabeel District", "One Za'abeel", "Dubai Islands",
];

export const ABU_DHABI_AREAS = [
  "Abu Dhabi Island", "Al Reem Island", "Al Raha Beach", "Al Raha Gardens",
  "Yas Island", "Saadiyat Island", "Al Maryah Island", "Hudayriyat Island",
  "Khalifa City", "Mohammed Bin Zayed City", "Shakhbout City", "Al Shamkha",
  "Al Reef", "Masdar City", "Mussafah", "Baniyas", "Al Wathba", "Zayed City",
  "Al Falah", "Corniche Area", "Al Khalidiyah", "Al Zahiyah",
];

export const SHARJAH_AREAS = [
  "Al Nahda", "Al Majaz", "Al Qasimia", "Al Khan", "Muwaileh",
  "Al Taawun", "Aljada", "University City", "Muweilah Commercial",
  "Al Mamzar", "Rolla", "Al Nabba", "Tilal City",
  "Sharjah Sustainable City", "Al Suyoh", "Al Rahmaniya",
];

export const AJMAN_AREAS = [
  "Al Nuaimiya", "Al Rashidiya", "Al Jurf", "Al Mowaihat", "Al Rawda",
  "Ajman Downtown", "Ajman Corniche", "Al Rumaila", "Al Zahya",
  "Al Helio", "Al Yasmeen", "Emirates City",
];

export const UAQ_AREAS = [
  "UAQ Marina", "Al Salamah", "Al Raas", "Falaj Al Mualla",
  "Al Dar Al Baida", "Al Abraq",
];

export const RAK_AREAS = [
  "Al Nakheel", "Al Hamra", "Al Hamra Village", "Al Marjan Island",
  "Khuzam", "Mina Al Arab", "Julphar", "Al Dhait", "Dafan Al Khor",
  "RAK City", "Al Jazirah Al Hamra",
];

export const FUJAIRAH_AREAS = [
  "Fujairah City", "Al Faseel", "Sakamkam", "Dibba", "Mirbah",
  "Qidfa", "Masafi", "Al Badiyah",
];

export const EMIRATE_AREAS = {
  Dubai: DUBAI_AREAS,
  "Abu Dhabi": ABU_DHABI_AREAS,
  Sharjah: SHARJAH_AREAS,
  Ajman: AJMAN_AREAS,
  "Umm Al Quwain": UAQ_AREAS,
  "Ras Al Khaimah": RAK_AREAS,
  Fujairah: FUJAIRAH_AREAS,
};

export const getAreasForEmirate = (emirate) => EMIRATE_AREAS[emirate] || [];

export const WARRANTY_OPTIONS = ["No", "Yes", "Dealer Warranty", "Manufacturer Warranty", "Extended Warranty"];
export const SERVICE_HISTORY_OPTIONS = ["No", "Yes", "Partial", "Agency Maintained", "Independent Garage"];
export const DOOR_OPTIONS = ["2", "3", "4", "5"];
export const CYLINDER_OPTIONS = ["3", "4", "5", "6", "8", "10", "12", "16"];
export const MIN_CAR_YEAR = 1986;

export const getYearOptions = (minYear = MIN_CAR_YEAR) => {
  const currentYear = new Date().getFullYear() + 1;
  const years = [];
  for (let y = currentYear; y >= minYear; y--) years.push(String(y));
  return years;
};

export const EXTERIOR_COLOR_OPTIONS = [
  "White", "Black", "Grey", "Silver", "Blue", "Red", "Green", "Yellow",
  "Orange", "Brown", "Beige", "Gold", "Purple", "Maroon", "Pink", "Other",
];

export const INTERIOR_COLOR_OPTIONS = [
  "Black", "Beige", "Brown", "White", "Grey", "Red", "Blue", "Tan",
  "Cream", "Orange", "Other",
];

export const FUEL_EFFICIENCY_OPTIONS = [
  "6","7","8","9","10","11","12","13","14","15","16","17","18","19",
  "20","21","22","23","24","25","26","27","28","29","30+",
];

export const TAG_OPTIONS = [
  "Lady Driven", "Doctor Driven", "Expat Owned",
  "Executive Driven", "Mallu Owned", "British Owned",
];

// Full make/model dataset (126 makes, every make with a model list) lives in
// carData.js — the same source the web app uses. Re-export it so all consumers
// of CAR_MAKES/CAR_MODELS (Explore filters, CarList filters, Post form) get the
// complete list. This used to be a hand-maintained subset (62 makes, models for
// only ~24) which left most manufacturers with an empty model picker on mobile.
export const CAR_MAKES = carMakes;
export const CAR_MODELS = carModels;

export const REGIONAL_SPECS = ["GCC", "North American", "European", "Japanese", "Korean", "Chinese", "Other"];

export const BODY_TYPES = ["Sedan", "SUV", "Hatchback", "Coupe", "Convertible", "Wagon", "Van", "Truck", "Other"];

export const FUEL_TYPES = ["Petrol", "Diesel", "Electric", "Hybrid", "Other"];

export const TRANSMISSION_TYPES = ["Automatic", "Manual"];

export const VEHICLE_CONDITIONS = ["Used", "New", "Certified Pre-Owned"];

export const OWNERSHIP_STATUS = ["First Owner", "Second Owner", "Third Owner or more", "Company Fleet"];

export const HORSEPOWER_OPTIONS = [
  "100-199", "200-299", "300-399", "400-499", "500-599", "600-699", "700-799", "800-899", "900-999", "1000+"
];

export const ENGINE_CAPACITY_OPTIONS = [
  "0-999cc", "1000-1499cc", "1500-1999cc", "2000-2499cc", "2500-2999cc",
  "3000-3499cc", "3500-3999cc", "4000-4499cc", "4500-4999cc", "5000cc+"
];

export const SEATING_CAPACITY = ["2", "4", "5", "6", "7", "8", "9+"];

export const STEERING_SIDES = ["Left", "Right"];

export const PLATE_CITIES = [
  { code: "د", name: "Dubai" },
  { code: "أ", name: "Abu Dhabi" },
  { code: "ش", name: "Sharjah" },
  { code: "ع", name: "Ajman" },
  { code: "و", name: "Umm Al Quwain" },
  { code: "ر", name: "Ras Al Khaimah" },
  { code: "ف", name: "Fujairah" },
];

export const PLATE_FORMATS = [
  "Standard", "Premium", "Special", "Motorcycle",
  "Temporary", "Diplomatic", "Military", "Government",
  "Classic", "Electric Vehicle", "Commercial", "Taxi",
  "Limousine", "Rental", "Tourism", "Transit",
  "Export", "Dealer", "Custom", "Rare Number",
  "Double Number", "Repeated Number", "Single Digit", "Golden Number", "Silver Number",
];

export const CAR_EXTRAS = {
  "Comfort & Convenience": [
    "Dual-zone Climate Control", "Tri-zone Climate Control", "Ventilated Seats",
    "Heated Seats", "Massage Seats", "Panoramic Sunroof", "Ambient Lighting",
    "Soft-Close Doors", "Heads-Up Display (HUD)", "Rear Window Sunshades",
    "Power Tailgate", "Auto-Dimming Mirrors", "Memory Seats",
  ],
  "Infotainment & Tech": [
    "Apple CarPlay", "Android Auto", "Rear Entertainment Screens",
    "Bluetooth Audio Streaming", "USB-C Fast Charging Ports",
    "360 Surround Camera", "Digital Cockpit", "Voice Command",
    "Wi-Fi Hotspot",
  ],
  "Safety & Driver Assistance": [
    "Adaptive Cruise Control", "Lane Keep Assist", "Blind Spot Monitoring",
    "Automatic Emergency Braking", "Traffic Sign Recognition",
    "Rear Cross Traffic Alert", "Night Vision Camera",
  ],
  "Luxury & Styling": [
    "Leather Dashboard", "Suede/Alcantara Headliner", "Carbon Fiber Trim",
    "Woodgrain Trim", "Illuminated Door Sills", "Chrome Package",
    "Blackout Package", "Sport Body Kit",
  ],
  "Off-Road / Performance": [
    "Diff Lock", "Air Suspension", "Skid Plates", "Snorkel",
    "Off-Road Camera Modes", "All-Terrain Drive Modes", "Tow Hook",
  ],
};

export const PART_TYPES = [
  "Engine", "Transmission", "Brakes", "Suspension", "Exhaust", "Electrical",
  "Body Parts", "Interior", "Wheels & Tires", "Lighting", "Performance",
  "Accessories", "Oil & Fluids", "Filters", "Belts & Hoses", "Other",
];

export const PART_CONDITIONS = ["New", "Used", "Refurbished"];

export const BIKE_BRANDS = [
  "Yamaha", "Honda", "Kawasaki", "Suzuki", "BMW", "Ducati", "KTM",
  "Triumph", "Harley-Davidson", "Indian", "Aprilia", "Moto Guzzi",
  "Royal Enfield", "Husqvarna", "CFMoto", "Benelli",
];

export const BIKE_TYPES = [
  "Sport", "Cruiser", "Adventure", "Touring", "Naked", "Enduro",
  "Scooter", "Chopper", "Dirt Bike", "Other",
];

export const BIKE_FEATURES = [
  'ABS', 'Traction Control', 'Ride Modes', 'Quick Shifter',
  'Cruise Control', 'Heated Grips', 'TPMS', 'Cornering Lights',
  'Launch Control', 'Wheelie Control', 'Slipper Clutch',
];
