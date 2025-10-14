// Generated car makes, models, and sample trims data
// Added major Chinese brands (BYD, Geely, Changan, Chery, MG, GAC, Haval, NIO, XPeng, Hongqi, Lynk & Co, Zeekr).
const carMakes = [
  'Acura', 'Alfa Romeo', 'Audi', 'Avatr', 'BAIC', 'BMW', 'BYD', 'Buick', 'Cadillac', 'Changan', 'Chery', 'Chevrolet', 'Chrysler', 'Denza', 'Dodge', 'Exeed', 'Fangchengbao', 'Ford', 'GAC', 'GMC', 'GWM', 'Geely', 'Genesis', 'Haval', 'Honda', 'Hongqi', 'Hyundai', 'INFINITI', 'Ineos', 'JAC', 'Jaecoo', 'Jaguar', 'Jeep', 'Jetour', 'Kia', 'Land Rover', 'Leapmotor', 'Lexus', 'Lincoln', 'Lynk & Co', 'MAZDA', 'MG', 'MINI', 'Maserati', 'Mercedes-Benz', 'Mitsubishi', 'NIO', 'Nissan', 'Omoda', 'Other', 'Polestar', 'Porsche', 'Ram', 'Roewe', 'Subaru', 'Tesla', 'Toyota', 'VinFast', 'Volkswagen', 'Volvo', 'Voyah', 'XPeng', 'Zeekr', 'iCar'
].sort();

// Car models organized by manufacturer
const carModels = {
  'Acura': ['ILX', 'Integra', 'MDX', 'RDX', 'TLX', 'NSX', 'RLX', 'TL', 'RSX'],
  'Alfa Romeo': ['Giulia', 'Stelvio', 'Tonale'],
  'Audi': ['A3', 'A4', 'A4 allroad', 'A5', 'A6', 'A6 allroad', 'A7', 'A8', 'e-tron', 'e-tron GT', 'e-tron S', 'e-tron S Sportback', 'e-tron Sportback', 'Q3', 'Q4 e-tron', 'Q5', 'Q5 Sportback', 'Q7', 'Q8', 'R8', 'RS 3', 'RS 4', 'RS 5', 'RS 6', 'RS 7', 'RS e-tron GT', 'RS Q8', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'SQ5', 'SQ5 Sportback', 'SQ7', 'SQ8', 'TT'],
  'BMW': ['2 Series', '3 Series', '4 Series', '5 Series', '7 Series', '8 Series', 'i4', 'i5', 'i7', 'iX', 'X1', 'X2', 'X3', 'X3 M', 'X4', 'X4 M', 'X5', 'X5 M', 'X6', 'X6 M', 'X7', 'XM', 'Z4', 'M2', 'M3', 'M4', 'M5', 'M8'],
  'Buick': ['Enclave', 'Encore', 'Encore GX', 'Envista', 'Envision'],
  // Chinese manufacturers and their popular models
  'BYD': ['Atto 3', 'Dolphin', 'Seal', 'Sealion 7', 'Seal 7', 'Song Plus', 'Qin Plus', 'Han', 'Shark 6', 'Seagull', 'Yuan Up', 'Tang', 'Leopard 3', 'Leopard 5', 'Leopard 7', 'Leopard 9', 'U8', 'U9'],
  'Geely': ['Coolray', 'Tugella', 'Monjaro', 'Emgrand', 'Okavango', 'Azkarra', 'Geometry C', 'Geometry E', 'Geometry A', 'Icon', 'Starray'],
  'Changan': ['Alsvin', 'CS35 Plus', 'CS75 Plus', 'CS95', 'Eado Plus', 'UNI-K', 'UNI-T', 'UNI-V', 'UNI-V 2.0', 'Hunter'],
  // Chery brand vehicles (excluding sub-brands Omoda, Jaecoo and Exeed which have their own entries)
  'Chery': ['Tiggo 4 Pro', 'Tiggo 7 Pro', 'Tiggo 8 Pro', 'Tiggo 8 Pro Max', 'Arrizo 5', 'Arrizo 6'],
  'MG': ['ZS', 'HS', 'RX5', 'RX9', 'GT', '3', '4', '5', '6', '7', 'One', 'T60', 'Cyberster', 'Whale', '8 PHEV'],
  'GAC': ['GS4', 'GS5', 'GS7', 'GS8', 'GA4', 'GA6', 'GN6', 'Emkoo', 'Empow', 'Aion S', 'Aion Y'],
  'Haval': ['H6', 'Jolion', 'Dargo', 'H9', 'H5', 'M6 Plus', 'H2'],
  'NIO': ['ES6', 'ES7', 'ES8', 'ET5', 'ET5 Touring', 'ET7', 'EC6', 'EC7'],
  'XPeng': ['G3', 'G3i', 'G9', 'P5', 'P7', 'P7i', 'X9'],
  'Hongqi': ['H9', 'HS5', 'HS7', 'E-HS9', 'H5', 'LS7'],
  'Lynk & Co': ['01', '02', '03', '03+', '05', '06', '07', '08'],
  'Zeekr': ['001', 'X', '009', '007'],
  'Cadillac': ['Celestiq', 'CT4', 'CT5', 'Escalade', 'Escalade ESV', 'LYRIQ', 'XT4', 'XT5', 'XT6', 'Lyriq'],
  'Chevrolet': ['Blazer', 'Blazer EV', 'Bolt EUV', 'Bolt EV', 'Camaro', 'Colorado Crew Cab', 'Corvette', 'Equinox', 'Equinox EV', 'Express 2500 Cargo', 'Express 2500 Passenger', 'Express 3500 Cargo', 'Express 3500 Passenger', 'Malibu', 'Silverado 1500 Crew Cab', 'Silverado 1500 Double Cab', 'Silverado 1500 Regular Cab', 'Silverado 2500 HD Crew Cab', 'Silverado 2500 HD Double Cab', 'Silverado 2500 HD Regular Cab', 'Silverado 3500 HD Crew Cab', 'Silverado 3500 HD Double Cab', 'Silverado 3500 HD Regular Cab', 'Suburban', 'Tahoe', 'Trailblazer', 'Traverse', 'Traverse Limited', 'Trax'],
  'Chrysler': ['300', 'Pacifica', 'Pacifica Hybrid', 'Voyager'],
  'Dodge': ['Challenger', 'Charger', 'Durango', 'Hornet', 'Journey', 'Grand Caravan'],
  'Ford': ['Bronco', 'Bronco Sport', 'Edge', 'Escape', 'Escape Plug-in Hybrid', 'Expedition', 'Expedition MAX', 'Explorer', 'F150 Lightning', 'F150 Regular Cab', 'F150 Super Cab', 'F150 SuperCrew Cab', 'F250 Super Duty Crew Cab', 'F250 Super Duty Regular Cab', 'F250 Super Duty Super Cab', 'F350 Super Duty Crew Cab', 'F350 Super Duty Regular Cab', 'F350 Super Duty Super Cab', 'F450 Super Duty Crew Cab', 'F450 Super Duty Regular Cab', 'Maverick', 'Mustang', 'Mustang Mach-E', 'Ranger SuperCrew', 'Transit 150 Cargo Van', 'Transit 250 Cargo Van', 'Transit 350 Cargo Van', 'Transit 350 HD Cargo Van', 'Transit 350 Passenger Van', 'E-Transit 350 Cargo Van'],
  'GMC': ['Acadia', 'Canyon Crew Cab', 'HUMMER EV Pickup', 'HUMMER EV SUV', 'Savana 2500 Cargo', 'Savana 2500 Passenger', 'Savana 3500 Cargo', 'Savana 3500 Passenger', 'Sierra 1500 Crew Cab', 'Sierra 1500 Double Cab', 'Sierra 1500 Regular Cab', 'Sierra 2500 HD Regular Cab', 'Sierra 3500 HD Regular Cab', 'Terrain', 'Yukon', 'Yukon XL'],
  'Genesis': ['Electrified G80', 'Electrified GV70', 'G70', 'G80', 'G90', 'GV60', 'GV70', 'GV80'],
  'Honda': ['Accord', 'Civic', 'CR-V', 'Pilot', 'HR-V', 'Odyssey', 'Ridgeline', 'Fit', 'Passport', 'Insight'],
  'Hyundai': ['Accent', 'Elantra', 'Elantra Hybrid', 'IONIQ 5', 'IONIQ 6', 'Ioniq Hybrid', 'Kona', 'Kona Electric', 'Kona N', 'Nexo', 'Palisade', 'Santa Cruz', 'Santa Fe', 'Santa Fe Plug-in Hybrid', 'Sonata', 'Tucson', 'Tucson Hybrid', 'Tucson Plug-in Hybrid', 'Venue', 'Veloster'],
  'INFINITI': ['Q50', 'Q60', 'QX50', 'QX55', 'QX60', 'QX80'],
  'Jaguar': ['E-PACE', 'F-PACE', 'F-TYPE', 'I-PACE', 'XF', 'XE'],
  'Jeep': ['Cherokee', 'Compass', 'Gladiator', 'Grand Cherokee', 'Grand Cherokee 4xe', 'Grand Cherokee L', 'Grand Wagoneer', 'Grand Wagoneer L', 'Renegade', 'Wagoneer', 'Wagoneer L', 'Wrangler', 'Wrangler Unlimited', 'Wrangler Unlimited 4xe'],
  'Kia': ['Carnival', 'EV6', 'Forte', 'K5', 'Niro', 'Niro EV', 'Niro Plug-in Hybrid', 'Rio', 'Seltos', 'Sorento', 'Sorento Hybrid', 'Sorento Plug-in Hybrid', 'Soul', 'Sportage', 'Sportage Hybrid', 'Sportage Plug-in Hybrid', 'Stinger', 'Telluride'],
  'Land Rover': ['Defender 110', 'Defender 130', 'Defender 90', 'Discovery', 'Discovery Sport', 'Range Rover', 'Range Rover Evoque', 'Range Rover Sport', 'Range Rover Velar'],
  'Lexus': ['ES', 'GX', 'IS', 'LC', 'LS', 'LX', 'NX', 'RC', 'RX', 'RZ', 'TX', 'UX'],
  'Lincoln': ['Aviator', 'Corsair', 'MKZ', 'Nautilus', 'Navigator', 'Navigator L'],
  'MAZDA': ['CX-30', 'CX-5', 'CX-50', 'CX-9', 'CX-90', 'MAZDA3', 'MAZDA6', 'MX-5 Miata'],
  'MINI': ['Clubman', 'Convertible', 'Countryman', 'Hardtop 2 Door', 'Hardtop 4 Door'],
  'Maserati': ['Grecale'],
  'Mercedes-Benz': ['A-Class', 'C-Class', 'E-Class', 'S-Class', 'GLA', 'GLB', 'GLC', 'GLE', 'GLS', 'G-Class', 'CLA', 'EQS', 'Maybach S-Class', 'AMG GT', 'EQS SUV', 'EQE', 'EQE SUV'],
  'Mitsubishi': ['Eclipse Cross', 'Mirage', 'Mirage G4', 'Outlander', 'Outlander PHEV', 'Outlander Sport'],
  'Nissan': ['Altima', 'Ariya', 'Armada', 'Frontier Crew Cab', 'Frontier King Cab', 'Kicks', 'LEAF', 'Maxima', 'Murano', 'Pathfinder', 'Rogue', 'Rogue Sport', 'Sentra', 'Titan Crew Cab', 'Titan King Cab', 'Titan XD Crew Cab', 'Versa', 'Z'],
  'Other': ['Other'],
  'Polestar': ['2', '3'],
  'Porsche': ['718 Boxster', '718 Cayman', '911', 'Cayenne', 'Macan', 'Panamera', 'Taycan'],
  'Ram': ['1500 Classic Crew Cab', '1500 Classic Quad Cab', '1500 Classic Regular Cab', '1500 Crew Cab', '1500 Quad Cab', '2500', '3500', 'ProMaster Cargo Van', 'ProMaster Window Van', 'ProMaster City'],
  'Subaru': ['Ascent', 'BRZ', 'Crosstrek', 'Forester', 'Impreza', 'Legacy', 'Outback', 'Solterra', 'WRX'],
  'Tesla': ['Cybertruck', 'Model 3', 'Model S', 'Model X', 'Model Y'],
  'Toyota': ['4Runner', '86', 'Avalon', 'bZ4X', 'C-HR', 'Camry', 'Camry Hybrid', 'Corolla', 'Corolla Cross', 'Corolla Cross Hybrid', 'Corolla Hatchback', 'Corolla Hybrid', 'Crown', 'GR Supra', 'GR86', 'Highlander', 'Highlander Hybrid', 'Land Cruiser', 'Prius', 'RAV4', 'RAV4 Hybrid', 'RAV4 Prime', 'Sequoia', 'Sienna', 'Tacoma', 'Tundra', 'Venza', 'Yaris', 'Supra'],
  'VinFast': ['VF 8', 'VF 9'],
  'Volkswagen': ['Arteon', 'Atlas', 'Atlas Cross Sport', 'Golf GTI', 'Golf R', 'ID.4', 'Jetta', 'Jetta GLI', 'Taos', 'Tiguan', 'Passat'],
  'Volvo': ['C40 Recharge', 'S60', 'S90', 'V60', 'V90', 'XC40', 'XC40 Recharge', 'XC60', 'XC90'],

  // New Chinese brands and their popular models
  'Omoda': [
    // The global OMODA&JAECOO website lists Omoda C5 and Omoda E5 as the brand's models
    'C5', 'E5'
  ],
  'Jaecoo': [
    // OMODA&JAECOO's lineup includes Jaecoo J5, J7, J7 SHS and J8
    'J5', 'J7', 'J7 SHS', 'J8'
  ],
  'Jetour': [
    // Jetour's official UAE site lists these SUV models: T1, T2, T2 i‑DM, Dashing, X50, X70 FL, X70 Plus, X90 Plus and G700
    'G700', 'T1', 'T2', 'T2 i-DM', 'Dashing', 'X50', 'X70 FL', 'X70 Plus', 'X90 Plus'
  ],
  'Exeed': [
    // Exeed UAE's model lineup includes the VX, TXL, LX, RX, ES and ET
    'VX', 'TXL', 'LX', 'RX', 'ES', 'ET'
  ],
  'Denza': [
    // According to Denza's product list on Wikipedia, current models include the D9 MPV, N7 SUV, N9 SUV, Z9 sedan and Z9 GT. Export‑only models such as the B5 and B8 are rebranded Bao 5 and Bao 8 for overseas markets
    'D9', 'N7', 'N9', 'Z9', 'Z9 GT', 'B5', 'B8'
  ],
  'Avatr': [
    // Changan's AVATR brand showcases upcoming models including Avatr 11, Avatr 12, Avatr 07, Avatr 06 and the limited‑edition MMW
    '11', '12', '07', '06', 'MMW'
  ],
  'Deepal': [
    // Deepal has launched five products: G318, S09, S07, S05 and L07
    'G318', 'S09', 'S07', 'S05', 'L07'
  ],
  'Fangchengbao': [
    // Fangchengbao's first vehicle is the Bao 5, later complemented by the Bao 8 and Tai 3
    'Bao 5', 'Bao 8', 'Tai 3'
  ],
  'Leapmotor': [
    // EV24.africa notes that Leapmotor's three main models are the C11 SUV, T03 compact and C01 sedan
    'C11', 'T03', 'C01'
  ],
  'Roewe': [
    // Borderless Car's summary of Roewe states that the brand currently offers models such as the eRX5, RX5 MAX, RX5 ePLUS, RX5 eMAX, iMAX8, Clever and i6 MAX EV. Additional recent offerings include the D5X DMH, D6 and D7 EV which have entered overseas markets
    'eRX5', 'RX5 MAX', 'RX5 ePLUS', 'RX5 eMAX', 'iMAX8', 'CLEVER', 'i6 MAX EV', 'D5X DMH', 'D6', 'D7 EV'
  ],
  'JAC': [
    // JAC Motors' UAE site lists passenger models JS3, J7, JS4 and JS6; the electric E30X; MPV models M4 (Passenger and Cargo); the Sunray van; and pickup variants T8 Petrol, T8 Diesel and T8 Pro
    'JS3', 'J7', 'JS4', 'JS6', 'E30X', 'M4 Passenger', 'M4 Cargo Van', 'Sunray Passenger', 'Sunray Cargo Van', 'T8', 'T8 Pro'
  ],
  'BAIC': [
    // BAIC's global site lists a broad range of models: off‑road BJ30, BJ80, BJ60, BJ40 Plus (and its variants), F40; SUVs such as the all‑new X7, X55 II and X35; the U5 Plus sedan; and electric models EU5 and EU5 Plus
    'BJ30', 'BJ80', 'BJ60', 'BJ40 Plus', 'BJ40 Plus RHD', 'BJ40 PRO', 'BJ40 SE', 'F40', 'X7', 'X55 II', 'X55 II RHD', 'X35', 'U5 Plus', 'EU5', 'EU5 Plus'
  ],
  'Voyah': [
    // According to the DDong Automobile catalogue, Voyah offers the Free and Free+, the Dreamer and Dreamer PHEV MPVs, and the Passion and Passion PHEV sedans. The UAE site also mentions the upcoming Courage crossover
    'Free', 'Free+', 'Dreamer', 'Dreamer PHEV', 'Passion', 'Passion PHEV', 'Courage'
  ],
  // Additional Chinese and specialty brands
  'GWM/Haval': [
    // GWM's UAE website lists a diverse range of SUVs, pickups and hybrids including Jolion Pro, H9, H7, H6, H6 GT, Tank 300, Tank 500, Wingle 5, Wingle 7, Poer, H6 Hybrid, Tank 300 Hybrid and Tank 500 HEV.
    'Jolion Pro', 'H9', 'H7', 'H6', 'H6 GT', 'Tank 300', 'Tank 500', 'Wingle 5', 'Wingle 7', 'Poer', 'H6 Hybrid', 'Tank 300 Hybrid', 'Tank 500 HEV'
  ],
  'Ineos': [
    // The Ineos Grenadier lineup comprises the Grenadier Station Wagon (Base, Fieldmaster and Trialmaster editions), the Quartermaster pickup (including Fieldmaster and Trialmaster editions) and the limited‑edition Grenadier 1924.
    'Grenadier Base', 'Grenadier Fieldmaster', 'Grenadier Trialmaster', 'Quartermaster', 'Quartermaster Fieldmaster', 'Quartermaster Trialmaster', 'Grenadier 1924'
  ],
  'iCar': [
    // Chery's iCar brand (also stylized iCAUR for export markets) currently produces the iCar 03 and iCar V23 battery‑electric compact SUVs, and the upcoming iCar V27 mid‑size EREV.
    '03', 'V23', 'V27'
  ],
};

// Sample trims for selected models (expand as needed)
const carTrims = {
  'Toyota': {
    'Camry': ['LE', 'SE', 'SE Nightshade', 'XLE', 'XSE', 'TRD'],
    'Corolla': ['L', 'LE', 'SE', 'XLE', 'XSE'],
    // The 2024 Toyota RAV4 is offered in six trims – LE, XLE, XLE Premium,
    // Adventure, TRD Off‑Road and Limited.
    'RAV4': ['LE', 'XLE', 'XLE Premium', 'Adventure', 'TRD Off-Road', 'Limited'],
  },
  'Honda': {
    'Civic': ['LX', 'Sport', 'EX', 'Touring', 'Si', 'Type R'],
    // According to Community Honda, the 2024 Honda Accord is offered in six trims –
    // LX, EX, Sport Hybrid, EX‑L Hybrid, Sport‑L Hybrid and Touring Hybrid.
    'Accord': ['LX', 'EX', 'Sport Hybrid', 'EX-L Hybrid', 'Sport-L Hybrid', 'Touring Hybrid'],
  },
  'Ford': {
    // The 2024 Ford F‑150 is available in eight trims – XL, STX, XLT, TREMOR,
    // LARIAT, King Ranch, Platinum and Raptor.
    'F150': ['XL', 'STX', 'XLT', 'Tremor', 'Lariat', 'King Ranch', 'Platinum', 'Raptor'],
  },
  'Tesla': {
    'Model 3': ['Standard Range Plus', 'Long Range', 'Performance'],
  },
  // Chinese brand trims
  'BYD': {
    // In the UK, the BYD Atto 3 launched with three trims: Active, Comfort and Design.
    'Atto 3': ['Active', 'Comfort', 'Design'],
  },
  'MG': {
    // The 2025 MG ZS is offered in Comfort, Deluxe and Deluxe Plus (Trophy) trims.
    'ZS': ['Comfort', 'Deluxe', 'Deluxe Plus (Trophy)'],
  },
};

export { carMakes, carModels, carTrims };