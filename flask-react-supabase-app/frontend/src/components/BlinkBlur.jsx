import React from 'react';
import './BlinkBlur.css';

const BlinkBlur = ({ 
  color = "#1f481f", 
  size = "medium", 
  text = "", 
  textColor = "#333" 
}) => {
  const sizeMap = {
    small: '40px',
    medium: '60px',
    large: '80px'
  };

  return (
    <div className="blink-blur-container">
      <div 
        className="blink-blur-spinner" 
        style={{ 
          width: sizeMap[size], 
          height: sizeMap[size],
          borderColor: color,
          borderTopColor: 'transparent'
        }}
      />
      {text && (
        <p className="blink-blur-text" style={{ color: textColor }}>
          {text}
        </p>
      )}
    </div>
  );
};

export default BlinkBlur;
