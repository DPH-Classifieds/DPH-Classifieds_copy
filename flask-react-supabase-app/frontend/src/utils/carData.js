// Car makes and models data for dropdowns
const carMakes = [
  'Toyota', 'Honda', 'Ford', 'Chevrolet', 'Nissan', 
  'BMW', 'Mercedes-Benz', 'Audi', 'Volkswagen', 'Hyundai', 
  'Kia', 'Mazda', 'Subaru', 'Lexus', 'Acura',
  'Jeep', 'Ram', 'Dodge', 'Chrysler', 'GMC',
  'Buick', 'Cadillac', 'Lincoln', 'Infiniti', 'Volvo',
  'Land Rover', 'Jaguar', 'Porsche', 'Tesla', 'Other'
].sort();

// Car models organized by manufacturer
const carModels = {
  Toyota: [
    'Camry', 'Corolla', 'RAV4', 'Highlander', 'Tacoma', 
    'Tundra', '4Runner', 'Prius', 'Avalon', 'Land Cruiser',
    'Sienna', 'Venza', 'Yaris', 'C-HR', 'Supra'
  ],
  Honda: [
    'Civic', 'Accord', 'CR-V', 'Pilot', 'HR-V',
    'Odyssey', 'Ridgeline', 'Fit', 'Passport', 'Insight'
  ],
  Ford: [
    'F-150', 'Escape', 'Explorer', 'Edge', 'Mustang',
    'Ranger', 'Bronco', 'Expedition', 'Fusion', 'Focus',
    'Maverick', 'Transit'
  ],
  Chevrolet: [
    'Silverado', 'Equinox', 'Traverse', 'Malibu', 'Tahoe',
    'Suburban', 'Colorado', 'Camaro', 'Blazer', 'Trax',
    'Corvette', 'Spark', 'Impala'
  ],
  Nissan: [
    'Altima', 'Sentra', 'Rogue', 'Pathfinder', 'Murano',
    'Frontier', 'Titan', 'Maxima', 'Kicks', 'Armada',
    'Versa', 'GT-R', 'Leaf'
  ],
  BMW: [
    '3 Series', '5 Series', 'X3', 'X5', '7 Series',
    'X1', 'X7', '4 Series', '8 Series', 'Z4',
    'i4', 'i3', 'iX', 'M3', 'M5'
  ],
  'Mercedes-Benz': [
    'C-Class', 'E-Class', 'S-Class', 'GLC', 'GLE',
    'GLA', 'GLB', 'GLS', 'A-Class', 'CLA',
    'G-Class', 'EQS', 'AMG GT', 'Maybach'
  ],
  Audi: [
    'A4', 'Q5', 'Q7', 'A6', 'Q3',
    'A3', 'Q8', 'e-tron', 'A8', 'A5',
    'TT', 'R8', 'S4', 'S5', 'RS6'
  ],
  Volkswagen: [
    'Jetta', 'Tiguan', 'Atlas', 'Passat', 'Golf',
    'Taos', 'ID.4', 'Arteon', 'GTI', 'Golf R'
  ],
  Hyundai: [
    'Elantra', 'Tucson', 'Santa Fe', 'Sonata', 'Kona',
    'Palisade', 'Venue', 'Accent', 'Ioniq', 'Veloster',
    'Nexo', 'Ioniq 5'
  ],
  Kia: [
    'Forte', 'Sportage', 'Sorento', 'Telluride', 'Soul',
    'Seltos', 'Carnival', 'K5', 'Rio', 'Niro',
    'Stinger', 'EV6'
  ],
  Mazda: [
    'CX-5', 'Mazda3', 'CX-9', 'CX-30', 'Mazda6',
    'MX-5 Miata', 'CX-50'
  ],
  Subaru: [
    'Outback', 'Forester', 'Crosstrek', 'Ascent', 'Impreza',
    'Legacy', 'WRX', 'BRZ'
  ],
  Lexus: [
    'RX', 'NX', 'ES', 'IS', 'GX',
    'UX', 'LX', 'LS', 'LC', 'RC'
  ],
  Acura: [
    'RDX', 'MDX', 'TLX', 'ILX', 'NSX',
    'RLX', 'TL', 'RSX'
  ],
  Jeep: [
    'Grand Cherokee', 'Wrangler', 'Cherokee', 'Compass', 'Renegade',
    'Gladiator', 'Wagoneer', 'Grand Wagoneer'
  ],
  Ram: [
    '1500', '2500', '3500', 'ProMaster', 'ProMaster City'
  ],
  Dodge: [
    'Challenger', 'Charger', 'Durango', 'Journey', 'Grand Caravan'
  ],
  Chrysler: [
    '300', 'Pacifica', 'Voyager'
  ],
  GMC: [
    'Sierra', 'Terrain', 'Acadia', 'Yukon', 'Canyon',
    'Hummer EV'
  ],
  Buick: [
    'Encore', 'Enclave', 'Envision', 'Encore GX'
  ],
  Cadillac: [
    'XT5', 'Escalade', 'CT5', 'XT4', 'CT4',
    'XT6', 'Lyriq'
  ],
  Lincoln: [
    'Navigator', 'Aviator', 'Corsair', 'Nautilus', 'MKZ'
  ],
  Infiniti: [
    'QX60', 'QX50', 'Q50', 'QX80', 'QX55',
    'Q60'
  ],
  Volvo: [
    'XC90', 'XC60', 'XC40', 'S60', 'S90',
    'V60', 'V90'
  ],
  'Land Rover': [
    'Range Rover', 'Discovery', 'Range Rover Sport', 'Range Rover Evoque', 'Range Rover Velar',
    'Discovery Sport', 'Defender'
  ],
  Jaguar: [
    'F-Pace', 'E-Pace', 'I-Pace', 'XF', 'F-Type',
    'XE'
  ],
  Porsche: [
    '911', 'Cayenne', 'Macan', 'Panamera', 'Taycan',
    '718 Cayman', '718 Boxster'
  ],
  Tesla: [
    'Model 3', 'Model Y', 'Model S', 'Model X', 'Cybertruck'
  ],
  Other: ['Other']
};

export { carMakes, carModels }; 