export const UAE_EMIRATES = [
  "Abu Dhabi",
  "Dubai",
  "Sharjah",
  "Ajman",
  "Umm Al Quwain",
  "Ras Al Khaimah",
  "Fujairah",
];

export const DUBAI_AREAS = [
  "Al Barari",
  "Al Barsha",
  "Al Furjan",
  "Al Garhoud",
  "Al Jaddaf",
  "Al Karama",
  "Al Khawaneej",
  "Al Mamzar",
  "Al Mizhar",
  "Al Nahda",
  "Al Quoz",
  "Al Qusais",
  "Al Safa",
  "Al Satwa",
  "Al Sufouh",
  "Al Twar",
  "Arabian Ranches",
  "Bluewaters Island",
  "Business Bay",
  "City Walk",
  "DAMAC Hills",
  "DIFC",
  "Discovery Gardens",
  "Downtown Dubai",
  "Dubai Creek Harbour",
  "Dubai Festival City",
  "Dubai Harbour",
  "Dubai Hills Estate",
  "Dubai Industrial City",
  "Dubai Investments Park (DIP)",
  "Dubai Marina",
  "Dubai Silicon Oasis",
  "Dubai Sports City",
  "Dubai Studio City",
  "Dubai South",
  "Emirates Hills",
  "International City",
  "Jebel Ali",
  "JLT (Jumeirah Lake Towers)",
  "Jumeirah",
  "Jumeirah Beach Residence (JBR)",
  "Jumeirah Golf Estates",
  "Jumeirah Islands",
  "Jumeirah Park",
  "Jumeirah Village Circle (JVC)",
  "Jumeirah Village Triangle (JVT)",
  "Liwan",
  "Meydan",
  "Mirdif",
  "Motor City",
  "Mudon",
  "Nad Al Sheba",
  "Palm Jumeirah",
  "Ras Al Khor",
  "Remraam",
  "Sheikh Zayed Road",
  "The Greens",
  "The Lakes",
  "The Springs",
  "The Sustainable City",
  "The Villa",
  "Town Square",
  "Umm Suqeim",
  "Wadi Al Safa",
];

export const EMIRATE_AREAS = {
  Dubai: DUBAI_AREAS,
  "Abu Dhabi": [
    "Abu Dhabi Island",
    "Al Reem Island",
    "Al Raha Beach",
    "Yas Island",
    "Khalifa City",
    "Mohammed Bin Zayed City",
    "Mussafah",
    "Baniyas",
    "Saadiyat Island",
    "Corniche Area",
  ],
  Sharjah: [
    "Al Nahda",
    "Al Majaz",
    "Al Qasimia",
    "Al Khan",
    "Muwaileh",
    "Al Taawun",
    "Aljada",
    "University City",
    "Muwailih Commercial",
    "Al Mamzar",
  ],
  Ajman: [
    "Al Nuaimiya",
    "Al Rashidiya",
    "Al Jurf",
    "Al Mowaihat",
    "Al Rawda",
    "Ajman Downtown",
    "Corniche Ajman",
    "Al Rumaila",
  ],
  "Umm Al Quwain": [
    "UAQ Marina",
    "Al Salamah",
    "Al Raas",
    "Falaj Al Mualla",
    "Al Dar Al Baida",
  ],
  "Ras Al Khaimah": [
    "Al Nakheel",
    "Al Hamra",
    "Al Marjan Island",
    "Khuzam",
    "Mina Al Arab",
    "Julphar",
    "Al Dhait",
    "Dafan Al Khor",
  ],
  Fujairah: [
    "Fujairah City",
    "Al Faseel",
    "Sakamkam",
    "Dibba",
    "Mirbah",
    "Qidfa",
    "Masafi",
  ],
};

export const getAreasForEmirate = (emirate) => EMIRATE_AREAS[emirate] || [];

export const WARRANTY_OPTIONS = [
  "No",
  "Yes",
  "Dealer Warranty",
  "Manufacturer Warranty",
  "Extended Warranty",
];

export const SERVICE_HISTORY_OPTIONS = [
  "No",
  "Yes",
  "Partial",
  "Agency Maintained",
  "Independent Garage",
];

export const DOOR_OPTIONS = ["2", "3", "4", "5"];

export const CYLINDER_OPTIONS = ["3", "4", "5", "6", "8", "10", "12", "16"];

export const MIN_CAR_YEAR = 1986;

export const getYearOptions = (minYear = MIN_CAR_YEAR) => {
  const maxYear = new Date().getFullYear() + 1;
  const years = [];
  for (let year = maxYear; year >= minYear; year -= 1) {
    years.push(String(year));
  }
  return years;
};
