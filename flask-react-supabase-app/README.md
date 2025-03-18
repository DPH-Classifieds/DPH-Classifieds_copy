# Flask + React + Supabase Car Classifieds App

This is a template application for a car classifieds website using Flask as the backend, React as the frontend, and Supabase for the database.

## Setup

### Prerequisites
- Python 3.7+
- Node.js 14+
- npm 6+
- A Supabase account

### Supabase Setup
1. Create a new Supabase project at [https://supabase.io](https://supabase.io)
2. Create a table named `cars` with the following columns:
   - `id` (primary key, auto-increment or UUID)
   - `make` (text)
   - `model` (text)
   - `year` (number)
   - `price` (number)
3. Insert some sample data into the `cars` table
4. Get your Supabase URL and API Key from the project settings

### Backend Setup
1. Navigate to the backend directory:
   ```
   cd flask-react-supabase-app/backend
   ```

2. Create and activate a virtual environment:
   ```
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. Install the dependencies:
   ```
   pip install -r requirements.txt
   ```

4. Update the `.env` file with your Supabase credentials:
   ```
   SUPABASE_URL=your_supabase_url_here
   SUPABASE_KEY=your_supabase_key_here
   ```

5. Run the Flask app:
   ```
   python app.py
   ```

   The backend will run on `http://localhost:5000`.

### Frontend Setup
1. Navigate to the frontend directory:
   ```
   cd flask-react-supabase-app/frontend
   ```

2. Install the dependencies:
   ```
   npm install
   ```

3. Run the React app:
   ```
   npm start
   ```

   The frontend will run on `http://localhost:3000`.

## Usage

Once both the backend and frontend are running, you can open your browser and navigate to `http://localhost:3000` to see the car listings.

## Project Structure

```
flask-react-supabase-app/
│
├── backend/
│   ├── venv/
│   ├── .env
│   ├── app.py
│   └── requirements.txt
│
└── frontend/
    ├── node_modules/
    ├── public/
    ├── src/
    │   ├── App.js
    │   ├── App.css
    │   └── ...
    ├── package.json
    └── ...
```

## Next Steps

This is a basic template. You can extend it by:
1. Adding authentication
2. Creating more detailed car listings with images
3. Adding search and filter functionality
4. Implementing user profiles and saved listings
5. Adding a form to post new car listings 