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

export const CAR_MAKES = [
  "Abarth", "Alfa Romeo", "Aston Martin", "Audi", "Bentley", "BMW",
  "Cadillac", "Chevrolet", "Chrysler", "Citroen", "Dacia", "Daewoo",
  "Daihatsu", "Dodge", "Ferrari", "Fiat", "Ford", "GAC", "Geely",
  "Genesis", "GMC", "Great Wall", "Haval", "Holden", "Honda",
  "Hyundai", "Infiniti", "Isuzu", "Jaguar", "Jeep", "Kia",
  "Lamborghini", "Land Rover", "Lexus", "Lincoln", "Lotus", "Maserati",
  "Mazda", "McLaren", "Mercedes-Benz", "MG", "Mini", "Mitsubishi",
  "Nissan", "Opel", "Peugeot", "Porsche", "Renault", "Rolls-Royce",
  "Rover", "Saab", "SEAT", "Skoda", "Smart", "SsangYong", "Subaru",
  "Suzuki", "Tesla", "Toyota", "Volkswagen", "Volvo", "Zeekr",
];

export const CAR_MODELS = {
  Toyota: ["Corolla", "Camry", "Land Cruiser", "Land Cruiser Prado", "RAV4", "Yaris", "Hilux", "Fortuner", "C-HR", "Highlander", "Supra", "Alphard", "Coaster"],
  Nissan: ["Patrol", "X-Trail", "Altima", "Sunny", "Kicks", "Maxima", "Murano", "Navara", "GT-R", "370Z", "Sentra", "Pathfinder"],
  BMW: ["3 Series", "5 Series", "7 Series", "X1", "X3", "X5", "X6", "X7", "M3", "M4", "M5", "Z4", "i4", "iX"],
  "Mercedes-Benz": ["C-Class", "E-Class", "S-Class", "A-Class", "GLA", "GLC", "GLE", "GLS", "AMG GT", "CLA", "CLS", "G-Class"],
  Audi: ["A3", "A4", "A6", "A8", "Q3", "Q5", "Q7", "Q8", "TT", "R8", "e-tron", "RS3", "RS6"],
  Porsche: ["911", "Cayenne", "Macan", "Panamera", "Taycan", "Boxster", "Cayman"],
  Honda: ["Civic", "Accord", "CR-V", "HR-V", "Pilot", "City", "Jazz"],
  Hyundai: ["Tucson", "Elantra", "Sonata", "Santa Fe", "Accent", "Kona", "Palisade", "Ioniq 5"],
  Ford: ["Explorer", "Mustang", "Edge", "Escape", "F-150", "Ranger", "Bronco"],
  Chevrolet: ["Tahoe", "Suburban", "Silverado", "Camaro", "Malibu", "Trailblazer", "Equinox"],
  Lexus: ["RX", "ES", "LS", "NX", "IS", "UX", "LX", "GX"],
  "Land Rover": ["Range Rover", "Range Rover Sport", "Range Rover Velar", "Discovery", "Defender", "Discovery Sport"],
  GAC: ["GS3", "GS4", "GS5", "GS8", "GN8", "Emkoo", "Empow"],
  Haval: ["H6", "Jolion", "Dargo", "F7", "H9"],
  Geely: ["Coolray", "Azkarra", "Tugella", "Emgrand", "Okavango"],
  MG: ["ZS", "HS", "MG5", "MG6", "Marvel R", "MG4"],
  Tesla: ["Model 3", "Model Y", "Model S", "Model X"],
  Genesis: ["G70", "G80", "G90", "GV60", "GV70", "GV80"],
  Mitsubishi: ["Pajero", "Outlander", "ASX", "L200", "Xpander"],
  Suzuki: ["Jimny", "Swift", "Vitara", "Ertiga"],
  Fiat: ["500", "Panda", "Tipo"],
  Dodge: ["Challenger", "Charger", "Durango", "RAM"],
  Jeep: ["Wrangler", "Grand Cherokee", "Cherokee", "Compass", "Gladiator"],
  Kia: ["Sportage", "Sorento", "Cerato", "Stinger", "Telluride", "Seltos", "EV6"],
};

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

export const PLATE_FORMATS = ["Standard", "Premium", "Special", "Motorcycle"];

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
