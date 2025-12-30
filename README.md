# 🚗 DPH Classifieds - UAE Automotive Marketplace

[![React](https://img.shields.io/badge/React-18.2.0-blue.svg)](https://reactjs.org/)
[![Flask](https://img.shields.io/badge/Flask-2.2.3-green.svg)](https://flask.palletsprojects.com/)
[![Supabase](https://img.shields.io/badge/Supabase-Database-orange.svg)](https://supabase.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> A comprehensive full-stack classified advertisements platform for the UAE automotive market, built with modern web technologies.

## 🌟 Overview

DPH Classifieds is a feature-rich marketplace platform designed specifically for the UAE automotive market. Users can buy and sell cars, motorcycles, license plates, and car parts through an intuitive web interface with advanced search capabilities, interactive maps, and secure user authentication.

### ✨ Key Highlights

- 🚗 **Multi-Category Marketplace**: Cars, Bikes, License Plates, and Car Parts
- 🔐 **Secure Authentication**: Supabase-powered user management with admin controls
- 📱 **Responsive Design**: Mobile-first approach with modern UI/UX
- 🗺️ **Interactive Maps**: Leaflet integration for location-based features
- 🖼️ **Image Management**: Multi-image upload with preview and optimization
- 🛡️ **Admin Dashboard**: Comprehensive content moderation system
- 🇦🇪 **UAE-Focused**: Localized for UAE market with emirate-specific features

## 🚀 Quick Start

### Prerequisites

- **Node.js** 16+ and npm
- **Python** 3.8+ with pip
- **Supabase Account** for database and authentication
- **Git** for version control

### Installation

1. **Clone the Repository**
   ```bash
   git clone https://github.com/your-username/Flask-React-superbase-classified.git
   cd Flask-React-superbase-classified
   ```

2. **Backend Setup**
   ```bash
   cd flask-react-supabase-app/backend
   
   # Create virtual environment
   python -m venv venv
   
   # Activate virtual environment
   # On Windows:
   venv\Scripts\activate
   # On macOS/Linux:
   source venv/bin/activate
   
   # Install dependencies
   pip install -r requirements.txt
   ```

3. **Frontend Setup**
   ```bash
   cd ../frontend
   npm install
   ```

4. **Environment Configuration**
   
   Create `.env` files in both backend and frontend directories:
   
   **Backend `.env`:**
   ```env
   SUPABASE_URL=your_supabase_project_url
   SUPABASE_KEY=your_supabase_anon_key
   SUPABASE_JWT_SECRET=your_jwt_secret
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   FLASK_SECRET_KEY=your_flask_secret_key
   FLASK_ENV=development
   ```
   
   **Frontend `.env`:**
   ```env
   REACT_APP_API_URL=http://localhost:8000
   REACT_APP_SUPABASE_URL=your_supabase_project_url
   REACT_APP_SUPABASE_KEY=your_supabase_anon_key
   ```

5. **Database Setup**
   
   Run the provided SQL schema files in your Supabase dashboard:
   ```bash
   # Execute these files in Supabase SQL editor:
   # 1. cars_schema.sql
   # 2. bikes_schema.sql
   # 3. All files in backend/migrations/
   ```

6. **Start the Application**
   
   **Backend (Terminal 1):**
   ```bash
   cd flask-react-supabase-app/backend
   python app.py
   ```
   
   **Frontend (Terminal 2):**
   ```bash
   cd flask-react-supabase-app/frontend
   npm start
   ```

7. **Access the Application**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8000

## 🏗️ Architecture

### System Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React Frontend│    │  Flask Backend  │    │   Supabase DB   │
│                 │    │                 │    │                 │
│  • User Interface│◄──►│  • REST API     │◄──►│  • PostgreSQL   │
│  • State Mgmt   │    │  • Auth Logic   │    │  • Row Level    │
│  • Routing      │    │  • File Upload  │    │    Security     │
│  • Components   │    │  • Admin Panel  │    │  • Real-time    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Tech Stack

#### Frontend Technologies
- **React 18.2.0** - Modern UI library with hooks
- **React Router 6.20.0** - Client-side routing
- **Leaflet** - Interactive maps for location features
- **Axios** - HTTP client for API communication
- **HTML2Canvas** - Screenshot generation for license plates
- **CSS3** - Modern styling with responsive design

#### Backend Technologies
- **Flask 2.2.3** - Lightweight Python web framework
- **Supabase** - Backend-as-a-Service for database and auth
- **PostgreSQL** - Robust relational database
- **PyJWT** - JSON Web Token handling
- **Pillow** - Python image processing
- **Gunicorn** - Production WSGI server

#### Infrastructure
- **Row Level Security (RLS)** - Database-level access control
- **JWT Authentication** - Stateless authentication
- **RESTful API** - Standard HTTP API design
- **File Upload System** - Secure image handling

## 📋 Features

### 🚗 Car Marketplace
- **Comprehensive Listings**: Detailed car specifications including make, model, year, mileage
- **Advanced Filtering**: Search by price, location, fuel type, transmission, features
- **Image Galleries**: Multiple high-quality images per listing
- **Interactive Maps**: Location selection and display using Leaflet
- **VIN Tracking**: Vehicle identification number support
- **Feature Tracking**: Climate control, navigation, premium sound, etc.

### 🏍️ Motorcycle Trading
- **Bike Categories**: Sport, Cruiser, Adventure, and custom categories
- **Performance Specs**: Engine size, horsepower, transmission details
- **Safety Features**: ABS, traction control, LED lighting options
- **Condition Tracking**: New, used, modified bike conditions

### 🔢 License Plate Exchange
- **UAE Plate System**: Support for all emirate codes (Dubai, Abu Dhabi, etc.)
- **Plate Generator**: Custom UAE license plate image generation
- **Format Support**: Standard, VIP, classic plate formats
- **Pricing System**: Market-based pricing with negotiation options

### 🔧 Auto Parts Marketplace
- **Part Categories**: Engine, brakes, wheels, electronics, accessories
- **Compatibility Matrix**: Compatible makes, models, and year ranges
- **Condition Grades**: New, used, refurbished with detailed descriptions
- **Bulk Listings**: Support for parts dealers and bulk sellers

### 👥 User Management
- **Secure Registration**: Email-based account creation with verification
- **Profile Management**: Personal information and contact details
- **Listing Dashboard**: Manage all user listings from one interface
- **Favorite System**: Save and track interesting listings

### 🛡️ Admin System
- **Content Moderation**: Approve/reject listings across all categories
- **User Management**: Admin promotion and user account oversight
- **Analytics Dashboard**: Listing statistics and platform metrics
- **Bulk Operations**: Mass approve/reject functionality

## 🔌 API Documentation

### Authentication Endpoints

| Method | Endpoint | Description | Authentication |
|--------|----------|-------------|---------------|
| POST | `/api/auth/login` | User login | None |
| POST | `/api/auth/signup` | User registration | None |
| POST | `/api/auth/logout` | User logout | Required |
| GET | `/api/auth/me` | Current user info | Required |
| POST | `/api/auth/refresh` | Refresh JWT token | Required |

### Car Management

| Method | Endpoint | Description | Authentication |
|--------|----------|-------------|---------------|
| GET | `/api/cars` | List approved cars | None |
| POST | `/api/cars` | Create car listing | Required |
| GET | `/api/cars/:id` | Get car details | None |
| PUT | `/api/cars/:id` | Update car listing | Owner/Admin |
| DELETE | `/api/cars/:id` | Delete car listing | Owner/Admin |
| GET | `/api/user/cars` | User's car listings | Required |

### File Upload

| Method | Endpoint | Description | Authentication |
|--------|----------|-------------|---------------|
| POST | `/api/upload-images` | Upload multiple images | Required |
| POST | `/api/cars/:id/images` | Add images to car | Owner/Admin |
| GET | `/static/uploads/:filename` | Serve uploaded files | None |

*Similar endpoints exist for bikes, parts, and license plates*

## 🗄️ Database Schema

### Core Tables

#### Users Table
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Cars Table
```sql
CREATE TABLE cars (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    car_manufacturer VARCHAR(100) NOT NULL,
    car_model VARCHAR(100) NOT NULL,
    make_year INT NOT NULL,
    expected_selling_price INT NOT NULL,
    car_city VARCHAR(50) NOT NULL,
    is_approved BOOLEAN DEFAULT FALSE,
    -- Additional 25+ specification fields
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Security Features
- **Row Level Security (RLS)** on all tables
- **User-scoped policies** for data access
- **Admin override policies** for moderation
- **Foreign key constraints** for data integrity

## 🚀 Deployment

### Production Setup

1. **Backend Deployment**
   ```bash
   # Install production dependencies
   pip install gunicorn
   
   # Run with Gunicorn
   gunicorn -w 4 -b 0.0.0.0:8000 app:app
   ```

2. **Frontend Deployment**
   ```bash
   # Build for production
   npm run build
   
   # Serve static files
   # Upload build/ folder to your hosting service
   ```

3. **Environment Variables**
   - Set production environment variables
   - Configure CORS origins for your domain
   - Update API URLs for production

### Docker Deployment (Optional)

```dockerfile
# Backend Dockerfile
FROM python:3.9-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:8000", "app:app"]
```

## 🤝 Contributing

We welcome contributions to DPH Classifieds! Here's how you can help:

### Development Workflow

1. **Fork the Repository**
   ```bash
   git fork https://github.com/your-username/Flask-React-superbase-classified.git
   ```

2. **Create Feature Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make Changes**
   - Follow existing code style and patterns
   - Add tests for new functionality
   - Update documentation as needed

4. **Test Your Changes**
   ```bash
   # Backend tests
   cd backend && python -m pytest
   
   # Frontend tests
   cd frontend && npm test
   ```

5. **Submit Pull Request**
   - Describe your changes clearly
   - Include screenshots for UI changes
   - Reference any related issues

### Code Style Guidelines

- **Python**: Follow PEP 8 standards
- **JavaScript**: Use ES6+ features, functional components
- **CSS**: Use BEM methodology for class naming
- **Git**: Use conventional commit messages

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

### Getting Help

- **Documentation**: Check this README and CHANGELOG.md
- **Issues**: Open an issue on GitHub for bugs or feature requests
- **Discussions**: Use GitHub Discussions for general questions

### Common Issues

1. **Database Connection Errors**
   - Verify Supabase credentials in .env files
   - Check network connectivity to Supabase

2. **Authentication Issues**
   - Ensure JWT secret matches between frontend and backend
   - Verify CORS settings for your domain

3. **File Upload Problems**
   - Check file permissions in static/uploads directory
   - Verify image file size limits

### Development Tips

- Use browser DevTools for debugging API calls
- Check backend console for detailed error messages
- Verify database policies in Supabase dashboard
- Test with different user roles (admin vs regular user)

## 🔮 Roadmap

### Upcoming Features
- [ ] **Mobile App**: React Native mobile application
- [ ] **Payment Integration**: Online payment for premium listings
- [ ] **Advanced Search**: AI-powered search and recommendations
- [ ] **Messaging System**: In-app messaging between buyers and sellers
- [ ] **Arabic Language**: RTL support and Arabic translations
- [ ] **Push Notifications**: Real-time notifications for new listings
- [ ] **Analytics Dashboard**: Advanced analytics for users and admins
- [ ] **Social Features**: User reviews and ratings system

### Performance Improvements
- [ ] **Caching Layer**: Redis for improved API performance
- [ ] **Image CDN**: Cloud-based image delivery optimization
- [ ] **Database Optimization**: Query optimization and indexing
- [ ] **Progressive Web App**: Enhanced mobile experience

---

## 📞 Contact

- **Developer**: Your Name
- **Email**: your.email@example.com
- **GitHub**: [@yourusername](https://github.com/yourusername)
- **Website**: [https://dph-classifieds.com](https://dph-classifieds.com)

---

<div align="center">

**Built with ❤️ for the UAE Automotive Community**

[⬆ Back to Top](#-dph-classifieds---uae-automotive-marketplace)

</div>
