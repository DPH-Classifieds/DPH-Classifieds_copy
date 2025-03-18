-- Create the cars table
CREATE TABLE cars (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    make TEXT NOT NULL,
    model TEXT NOT NULL,
    year INTEGER NOT NULL,
    price NUMERIC(10, 2) NOT NULL
);

-- Add some sample data
INSERT INTO cars (make, model, year, price) VALUES
    ('Toyota', 'Camry', 2020, 25000.00),
    ('Honda', 'Civic', 2019, 22000.00),
    ('Ford', 'Mustang', 2021, 35000.00),
    ('Chevrolet', 'Malibu', 2018, 19500.00),
    ('Nissan', 'Altima', 2020, 23500.00); 