-- Bikes Table
CREATE TABLE bikes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    bike_manufacturer VARCHAR(100) NOT NULL,
    bike_model VARCHAR(100) NOT NULL,
    bike_type VARCHAR(50) NOT NULL,
    year INT NOT NULL,
    mileage INT,
    engine_size VARCHAR(50),
    color VARCHAR(50),
    price DECIMAL(10, 2) NOT NULL,
    location VARCHAR(100) NOT NULL,
    contact_number VARCHAR(20),
    description TEXT,
    
    -- Performance details
    transmission VARCHAR(50),
    fuel_type VARCHAR(50),
    
    -- Features
    abs BOOLEAN DEFAULT FALSE,
    traction_control BOOLEAN DEFAULT FALSE,
    led_lights BOOLEAN DEFAULT FALSE,
    keyless_ignition BOOLEAN DEFAULT FALSE,
    cruise_control BOOLEAN DEFAULT FALSE,
    heated_grips BOOLEAN DEFAULT FALSE,
    passenger_seat BOOLEAN DEFAULT FALSE,
    windshield BOOLEAN DEFAULT FALSE,
    
    is_approved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bike Images Table
CREATE TABLE bike_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bike_id UUID REFERENCES bikes ON DELETE CASCADE NOT NULL,
    url TEXT NOT NULL,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Update License Plates Table with more fields
ALTER TABLE license_plates 
ADD COLUMN IF NOT EXISTS user_id UUID,
ADD COLUMN IF NOT EXISTS title VARCHAR(200),
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS contact_number VARCHAR(20),
ADD COLUMN IF NOT EXISTS location VARCHAR(100),
ADD COLUMN IF NOT EXISTS price DECIMAL(10, 2),
ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_negotiable BOOLEAN DEFAULT FALSE;

-- License Plate Images Table
CREATE TABLE plate_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plate_id UUID REFERENCES license_plates ON DELETE CASCADE NOT NULL,
    url TEXT NOT NULL,
    is_main BOOLEAN DEFAULT FALSE,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Car Parts Table
CREATE TABLE car_parts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    part_name VARCHAR(200) NOT NULL,
    part_type VARCHAR(100) NOT NULL,
    compatible_makes TEXT[], -- Array of compatible car manufacturers
    compatible_models TEXT[], -- Array of compatible car models
    compatible_years VARCHAR(100), -- Can be a range like "2010-2020"
    condition VARCHAR(50) NOT NULL, -- New, Used, Refurbished
    price DECIMAL(10, 2) NOT NULL,
    location VARCHAR(100) NOT NULL,
    contact_number VARCHAR(20),
    description TEXT,
    is_negotiable BOOLEAN DEFAULT FALSE,
    is_approved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Car Parts Images Table
CREATE TABLE part_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    part_id UUID REFERENCES car_parts ON DELETE CASCADE NOT NULL,
    url TEXT NOT NULL,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add RLS (Row Level Security) Policies
ALTER TABLE bikes ENABLE ROW LEVEL SECURITY;
ALTER TABLE bike_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE plate_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE car_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_images ENABLE ROW LEVEL SECURITY;

-- Bikes policies
CREATE POLICY "Users can view approved bikes" 
ON bikes FOR SELECT USING (is_approved = TRUE);

CREATE POLICY "Users can view their own unapproved bikes" 
ON bikes FOR SELECT USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can insert their own bikes" 
ON bikes FOR INSERT WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can update their own bikes" 
ON bikes FOR UPDATE USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can delete their own bikes" 
ON bikes FOR DELETE USING (user_id = auth.uid() OR user_id IS NULL);

-- Bike images policies
CREATE POLICY "Anyone can view bike images" 
ON bike_images FOR SELECT USING (TRUE);

CREATE POLICY "Users can insert images for their bikes" 
ON bike_images FOR INSERT WITH CHECK (
    bike_id IN (SELECT id FROM bikes WHERE user_id = auth.uid() OR user_id IS NULL)
);

CREATE POLICY "Users can update images for their bikes" 
ON bike_images FOR UPDATE USING (
    bike_id IN (SELECT id FROM bikes WHERE user_id = auth.uid() OR user_id IS NULL)
);

CREATE POLICY "Users can delete images for their bikes" 
ON bike_images FOR DELETE USING (
    bike_id IN (SELECT id FROM bikes WHERE user_id = auth.uid() OR user_id IS NULL)
);

-- Updated license plates policies
CREATE POLICY "Users can view approved license plates" 
ON license_plates FOR SELECT USING (is_approved = TRUE OR user_id IS NULL);

CREATE POLICY "Users can view their own unapproved license plates" 
ON license_plates FOR SELECT USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can insert their own license plates" 
ON license_plates FOR INSERT WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can update their own license plates" 
ON license_plates FOR UPDATE USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can delete their own license plates" 
ON license_plates FOR DELETE USING (user_id = auth.uid() OR user_id IS NULL);

-- License plate images policies
CREATE POLICY "Anyone can view license plate images" 
ON plate_images FOR SELECT USING (TRUE);

CREATE POLICY "Users can insert images for their license plates" 
ON plate_images FOR INSERT WITH CHECK (
    plate_id IN (SELECT id FROM license_plates WHERE user_id = auth.uid() OR user_id IS NULL)
);

CREATE POLICY "Users can update images for their license plates" 
ON plate_images FOR UPDATE USING (
    plate_id IN (SELECT id FROM license_plates WHERE user_id = auth.uid() OR user_id IS NULL)
);

CREATE POLICY "Users can delete images for their license plates" 
ON plate_images FOR DELETE USING (
    plate_id IN (SELECT id FROM license_plates WHERE user_id = auth.uid() OR user_id IS NULL)
);

-- Car parts policies
CREATE POLICY "Users can view approved car parts" 
ON car_parts FOR SELECT USING (is_approved = TRUE);

CREATE POLICY "Users can view their own unapproved car parts" 
ON car_parts FOR SELECT USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can insert their own car parts" 
ON car_parts FOR INSERT WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can update their own car parts" 
ON car_parts FOR UPDATE USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can delete their own car parts" 
ON car_parts FOR DELETE USING (user_id = auth.uid() OR user_id IS NULL);

-- Car part images policies
CREATE POLICY "Anyone can view car part images" 
ON part_images FOR SELECT USING (TRUE);

CREATE POLICY "Users can insert images for their car parts" 
ON part_images FOR INSERT WITH CHECK (
    part_id IN (SELECT id FROM car_parts WHERE user_id = auth.uid() OR user_id IS NULL)
);

CREATE POLICY "Users can update images for their car parts" 
ON part_images FOR UPDATE USING (
    part_id IN (SELECT id FROM car_parts WHERE user_id = auth.uid() OR user_id IS NULL)
);

CREATE POLICY "Users can delete images for their car parts" 
ON part_images FOR DELETE USING (
    part_id IN (SELECT id FROM car_parts WHERE user_id = auth.uid() OR user_id IS NULL)
);

-- Create indexes for better performance
CREATE INDEX idx_bikes_user_id ON bikes(user_id);
CREATE INDEX idx_bikes_manufacturer ON bikes(bike_manufacturer);
CREATE INDEX idx_bikes_model ON bikes(bike_model);
CREATE INDEX idx_bikes_type ON bikes(bike_type);
CREATE INDEX idx_bikes_price ON bikes(price);
CREATE INDEX idx_bikes_year ON bikes(year);
CREATE INDEX idx_bike_images_bike_id ON bike_images(bike_id);

CREATE INDEX idx_license_plates_user_id ON license_plates(user_id);
CREATE INDEX idx_license_plates_city ON license_plates(city);
CREATE INDEX idx_license_plates_code ON license_plates(code);
CREATE INDEX idx_license_plates_price ON license_plates(price);
CREATE INDEX idx_plate_images_plate_id ON plate_images(plate_id);

CREATE INDEX idx_car_parts_user_id ON car_parts(user_id);
CREATE INDEX idx_car_parts_name ON car_parts(part_name);
CREATE INDEX idx_car_parts_type ON car_parts(part_type);
CREATE INDEX idx_car_parts_price ON car_parts(price);
CREATE INDEX idx_car_parts_condition ON car_parts(condition);
CREATE INDEX idx_part_images_part_id ON part_images(part_id);

-- Sample data for bikes table
INSERT INTO bikes (
    user_id,
    bike_manufacturer,
    bike_model,
    bike_type,
    year,
    mileage,
    engine_size,
    color,
    price,
    location,
    contact_number,
    description,
    transmission,
    fuel_type,
    abs,
    traction_control,
    is_approved
) VALUES 
(
    NULL,
    'Honda',
    'CBR600RR',
    'Sport',
    2022,
    5000,
    '600cc',
    'Red',
    12000.00,
    'Dubai',
    '5551234567',
    'Excellent condition Honda CBR600RR with low mileage. Well maintained and garage kept.',
    'Manual',
    'Gasoline',
    TRUE,
    TRUE,
    TRUE
),
(
    NULL,
    'Harley-Davidson',
    'Street Glide',
    'Cruiser',
    2020,
    15000,
    '1868cc',
    'Black',
    25000.00,
    'Abu Dhabi',
    '5559876543',
    'Beautiful Harley-Davidson Street Glide with custom exhaust and accessories.',
    'Manual',
    'Gasoline',
    TRUE,
    FALSE,
    TRUE
),
(
    NULL,
    'BMW',
    'R1250GS',
    'Adventure',
    2021,
    8000,
    '1254cc',
    'Blue/White',
    18000.00,
    'Sharjah',
    '5552468135',
    'BMW R1250GS Adventure model with all service records and touring accessories.',
    'Manual',
    'Gasoline',
    TRUE,
    TRUE,
    TRUE
);

-- Sample data for car parts
INSERT INTO car_parts (
    user_id,
    part_name,
    part_type,
    compatible_makes,
    compatible_models,
    compatible_years,
    condition,
    price,
    location,
    contact_number,
    description,
    is_negotiable,
    is_approved
) VALUES 
(
    NULL,
    'OEM Toyota Camry Headlight Assembly',
    'Lighting',
    ARRAY['Toyota'],
    ARRAY['Camry'],
    '2018-2022',
    'New',
    350.00,
    'Dubai',
    '5551234567',
    'Brand new OEM headlight assembly for Toyota Camry. Driver side (left).',
    TRUE,
    TRUE
),
(
    NULL,
    'BMW 3-Series Brake Kit',
    'Brakes',
    ARRAY['BMW'],
    ARRAY['3-Series', '4-Series'],
    '2015-2020',
    'New',
    450.00,
    'Abu Dhabi',
    '5559876543',
    'Complete brake kit for BMW 3-Series and 4-Series. Includes rotors, pads, and hardware.',
    TRUE,
    TRUE
),
(
    NULL,
    'Mercedes-Benz AMG Wheels Set',
    'Wheels',
    ARRAY['Mercedes-Benz'],
    ARRAY['C-Class', 'E-Class'],
    '2019-2023',
    'Used',
    1200.00,
    'Sharjah',
    '5552468135',
    'Set of 4 genuine AMG wheels in excellent condition. Minor curb rash on one wheel.',
    TRUE,
    TRUE
); 