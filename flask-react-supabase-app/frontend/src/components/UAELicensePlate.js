import React from 'react';
import PropTypes from 'prop-types';

const UAELicensePlate = ({ city, code, number, className }) => {
  // Function to render different plate styles based on the city
  const renderPlate = () => {
    const cityLower = city.toLowerCase();
    
    switch(cityLower) {
      case 'dubai':
        return renderDubaiPlate();
      case 'abu dhabi':
        return renderAbuDhabiPlate();
      case 'sharjah':
        return renderSharjahPlate();
      case 'ajman':
        return renderAjmanPlate();
      case 'fujairah':
        return renderFujairahPlate();
      case 'ras al khaimah':
        return renderRasAlKhaimahPlate();
      case 'umm al quwain':
        return renderUmmAlQuwainPlate();
      default:
        return renderDubaiPlate(); // Default to Dubai style
    }
  };

  // Dubai style plate
  const renderDubaiPlate = () => (
    <div className={`uae-license-plate dubai ${className || ''}`}>
      <div className="plate-left">
        <div className="plate-code">{code}</div>
      </div>
      <div className="plate-middle">
        <div className="plate-uae">U.A.E</div>
        <div className="plate-city-arabic">دبي</div>
      </div>
      <div className="plate-right">
        <div className="plate-number">{number}</div>
      </div>
    </div>
  );

  // Abu Dhabi style plate
  const renderAbuDhabiPlate = () => (
    <div className={`uae-license-plate abu-dhabi ${className || ''}`}>
      <div className="plate-left">
        <div className="plate-code">{code}</div>
      </div>
      <div className="plate-middle">
        <div className="plate-uae">U.A.E</div>
        <div className="plate-city-arabic">أبو ظبي</div>
      </div>
      <div className="plate-right">
        <div className="plate-number">{number}</div>
      </div>
    </div>
  );

  // Sharjah style plate
  const renderSharjahPlate = () => (
    <div className={`uae-license-plate sharjah ${className || ''}`}>
      <div className="plate-left">
        <div className="plate-code">{code}</div>
      </div>
      <div className="plate-middle">
        <div className="plate-uae">U.A.E</div>
        <div className="plate-city-arabic">الشارقة</div>
      </div>
      <div className="plate-right">
        <div className="plate-number">{number}</div>
      </div>
    </div>
  );
  
  // Ajman style plate
  const renderAjmanPlate = () => (
    <div className={`uae-license-plate ajman ${className || ''}`}>
      <div className="plate-left">
        <div className="plate-code">{code}</div>
      </div>
      <div className="plate-middle">
        <div className="plate-uae">U.A.E</div>
        <div className="plate-city-arabic">عجمان</div>
      </div>
      <div className="plate-right">
        <div className="plate-number">{number}</div>
      </div>
    </div>
  );
  
  // Fujairah style plate
  const renderFujairahPlate = () => (
    <div className={`uae-license-plate fujairah ${className || ''}`}>
      <div className="plate-left">
        <div className="plate-code">{code}</div>
      </div>
      <div className="plate-middle">
        <div className="plate-uae">U.A.E</div>
        <div className="plate-city-arabic">الفجيرة</div>
      </div>
      <div className="plate-right">
        <div className="plate-number">{number}</div>
      </div>
    </div>
  );
  
  // Ras Al Khaimah style plate
  const renderRasAlKhaimahPlate = () => (
    <div className={`uae-license-plate ras-al-khaimah ${className || ''}`}>
      <div className="plate-left">
        <div className="plate-code">{code}</div>
      </div>
      <div className="plate-middle">
        <div className="plate-uae">U.A.E</div>
        <div className="plate-city-arabic">رأس الخيمة</div>
      </div>
      <div className="plate-right">
        <div className="plate-number">{number}</div>
      </div>
    </div>
  );
  
  // Umm Al Quwain style plate
  const renderUmmAlQuwainPlate = () => (
    <div className={`uae-license-plate umm-al-quwain ${className || ''}`}>
      <div className="plate-left">
        <div className="plate-code">{code}</div>
      </div>
      <div className="plate-middle">
        <div className="plate-uae">U.A.E</div>
        <div className="plate-city-arabic">أم القيوين</div>
      </div>
      <div className="plate-right">
        <div className="plate-number">{number}</div>
      </div>
    </div>
  );

  return renderPlate();
};

UAELicensePlate.propTypes = {
  city: PropTypes.string.isRequired,
  code: PropTypes.string.isRequired,
  number: PropTypes.string.isRequired,
  className: PropTypes.string
};

export default UAELicensePlate; 