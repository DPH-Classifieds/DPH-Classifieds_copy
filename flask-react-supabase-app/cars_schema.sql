-- Cars Table
CREATE TABLE cars (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,  -- Removing the foreign key constraint for now
    car_manufacturer VARCHAR(100) NOT NULL,
    car_model VARCHAR(100) NOT NULL,
    trim VARCHAR(100),
    regional_spec VARCHAR(25) NOT NULL,
    make_year INT NOT NULL,
    kilometer_driven INT,
    body_type VARCHAR(100),
    is_insured BOOLEAN DEFAULT FALSE,
    expected_selling_price INT NOT NULL,
    car_owner_phone_number VARCHAR(20),
    car_city VARCHAR(50) NOT NULL,
    listing_title VARCHAR(200) NOT NULL,
    tour_url VARCHAR(400),
    car_description TEXT,
    fuel_type VARCHAR(25) NOT NULL,
    transmission_type VARCHAR(25) NOT NULL,
    seating_capacity VARCHAR(25),
    horsepower VARCHAR(25) NOT NULL,
    engine_capacity VARCHAR(25),
    steering_side VARCHAR(25) NOT NULL,
    
    -- Extras/Features
    climate_control BOOLEAN DEFAULT FALSE,
    dvd_player BOOLEAN DEFAULT FALSE,
    keyless_entry BOOLEAN DEFAULT FALSE,
    navigation_system BOOLEAN DEFAULT FALSE,
    premium_sound_system BOOLEAN DEFAULT FALSE,
    cooled_seats BOOLEAN DEFAULT FALSE,
    front_wheel_drive BOOLEAN DEFAULT FALSE,
    leather_seats BOOLEAN DEFAULT FALSE,
    parking_sensors BOOLEAN DEFAULT FALSE,
    rear_view_camera BOOLEAN DEFAULT FALSE,
    
    car_location VARCHAR(200),
    vehicle_type VARCHAR(25) NOT NULL,
    is_approved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Car Images Table
CREATE TABLE car_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    car_id UUID REFERENCES cars ON DELETE CASCADE NOT NULL,
    image_url TEXT NOT NULL,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Privacy Policy Table
CREATE TABLE privacy_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    privacy_policy TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Advertisements Table
CREATE TABLE advertisements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    popup_ad_url TEXT,
    popup_ad_link TEXT,
    ad1_url TEXT,
    ad1_link TEXT,
    ad2_url TEXT,
    ad2_link TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Clients Table (for OTP verification)
CREATE TABLE clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100),
    phone_number VARCHAR(20) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- License Plates Table
CREATE TABLE license_plates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    city VARCHAR(100) DEFAULT 'All cities',
    code VARCHAR(100) DEFAULT 'All codes',
    digits VARCHAR(100) DEFAULT 'Any digits',
    price DECIMAL(10, 2),
    number VARCHAR(100),
    plate_format VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add RLS (Row Level Security) Policies
ALTER TABLE cars ENABLE ROW LEVEL SECURITY;
ALTER TABLE car_images ENABLE ROW LEVEL SECURITY;

-- Policy for cars: users can read all approved cars, but only edit their own
CREATE POLICY "Users can view approved cars" 
ON cars FOR SELECT USING (is_approved = TRUE);

CREATE POLICY "Users can view their own unapproved cars" 
ON cars FOR SELECT USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can insert their own cars" 
ON cars FOR INSERT WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can update their own cars" 
ON cars FOR UPDATE USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can delete their own cars" 
ON cars FOR DELETE USING (user_id = auth.uid() OR user_id IS NULL);

-- Policy for car_images: anyone can view, only owners can modify
CREATE POLICY "Anyone can view car images" 
ON car_images FOR SELECT USING (TRUE);

CREATE POLICY "Users can insert images for their cars" 
ON car_images FOR INSERT WITH CHECK (
    car_id IN (SELECT id FROM cars WHERE user_id = auth.uid() OR user_id IS NULL)
);

CREATE POLICY "Users can update images for their cars" 
ON car_images FOR UPDATE USING (
    car_id IN (SELECT id FROM cars WHERE user_id = auth.uid() OR user_id IS NULL)
);

CREATE POLICY "Users can delete images for their cars" 
ON car_images FOR DELETE USING (
    car_id IN (SELECT id FROM cars WHERE user_id = auth.uid() OR user_id IS NULL)
);

-- Create indexes for better performance
CREATE INDEX idx_cars_user_id ON cars(user_id);
CREATE INDEX idx_cars_manufacturer ON cars(car_manufacturer);
CREATE INDEX idx_cars_model ON cars(car_model);
CREATE INDEX idx_cars_city ON cars(car_city);
CREATE INDEX idx_cars_make_year ON cars(make_year);
CREATE INDEX idx_cars_price ON cars(expected_selling_price);
CREATE INDEX idx_car_images_car_id ON car_images(car_id);

-- Sample data for cars table
INSERT INTO cars (
    user_id, 
    car_manufacturer, 
    car_model, 
    trim, 
    regional_spec, 
    make_year, 
    kilometer_driven, 
    body_type, 
    is_insured, 
    expected_selling_price, 
    car_owner_phone_number, 
    car_city, 
    listing_title, 
    car_description, 
    fuel_type, 
    transmission_type, 
    seating_capacity, 
    horsepower, 
    engine_capacity, 
    steering_side, 
    vehicle_type, 
    is_approved
) VALUES 
(
    NULL, -- Removed the user_id reference 
    'Toyota', 
    'Camry', 
    'LE', 
    'USA', 
    2020, 
    35000, 
    'Sedan', 
    TRUE, 
    25000, 
    '5551234567', 
    'New York', 
    '2020 Toyota Camry LE', 
    'Well maintained Toyota Camry with low mileage. Single owner, all service records available.', 
    'Gasoline', 
    'Automatic', 
    '5', 
    '203', 
    '2.5L', 
    'Left', 
    'Used', 
    TRUE
),
(
    NULL, -- Removed the user_id reference
    'Honda', 
    'Civic', 
    'Sport', 
    'Japan', 
    2019, 
    42000, 
    'Sedan', 
    TRUE, 
    22000, 
    '5559876543', 
    'Chicago', 
    '2019 Honda Civic Sport', 
    'Sporty Honda Civic in excellent condition. New tires, recently serviced.', 
    'Gasoline', 
    'Manual', 
    '5', 
    '180', 
    '1.5L', 
    'Left', 
    'Used', 
    TRUE
),
(
    NULL, -- Removed the user_id reference
    'Ford', 
    'Mustang', 
    'GT', 
    'USA', 
    2021, 
    15000, 
    'Coupe', 
    TRUE, 
    45000, 
    '5552468135', 
    'Los Angeles', 
    '2021 Ford Mustang GT', 
    'Powerful Mustang GT with premium features. Garage kept, never raced.', 
    'Gasoline', 
    'Automatic', 
    '4', 
    '460', 
    '5.0L', 
    'Left', 
    'Used', 
    TRUE
);

-- Sample data for privacy_policies
INSERT INTO privacy_policies (privacy_policy) VALUES 
('This Privacy Policy describes how your personal information is collected, used, and shared when you visit or make a purchase from our car marketplace.');

-- Sample data for advertisements
INSERT INTO advertisements (popup_ad_url, popup_ad_link, ad1_url, ad1_link, ad2_url, ad2_link) VALUES 
('https://example.com/ads/popup.jpg', 'https://example.com/special-offer', 
 'https://example.com/ads/sidebar1.jpg', 'https://example.com/new-model', 
 'https://example.com/ads/sidebar2.jpg', 'https://example.com/financing');

-- Sample data for license_plates
INSERT INTO license_plates (city, code, digits, price, number, plate_format) VALUES 
('Dubai', 'S', '3', 15000.00, '123', 'Standard'),
('Abu Dhabi', 'A', '2', 25000.00, '88', 'VIP'),
('Sharjah', 'B', '4', 12000.00, '5678', 'Classic'); 