/**
 * Profile Completion Calculator
 * Calculates what percentage of the profile is complete
 */

/**
 * Calculate profile completion percentage
 * @param {Object} userData - User profile data
 * @returns {Object} - { percentage, missingFields, completedFields }
 */
export const calculateProfileCompletion = (userData) => {
  if (!userData) {
    return { percentage: 0, missingFields: [], completedFields: [] };
  }

  // Define required and optional fields with their weights
  const fields = {
    // Essential fields (higher weight) - 60% total
    essential: [
      { key: 'email', label: 'Email', weight: 10 },
      { key: 'first_name', label: 'First Name', weight: 10 },
      { key: 'last_name', label: 'Last Name', weight: 10 },
      { key: 'phone', label: 'Phone Number', weight: 10 },
      { key: 'emirate', label: 'Emirate', weight: 10 },
      { key: 'city', label: 'Area', weight: 10 },
    ],
    
    // Important fields - 30% total
    important: [
      { key: 'username', label: 'Username', weight: 5 },
      { key: 'display_name', label: 'Display Name', weight: 5 },
      { key: 'bio', label: 'Bio', weight: 5 },
      { key: 'country_code', label: 'Country Code', weight: 5 },
      { key: 'profile_photo_url', label: 'Profile Photo', weight: 10 },
    ],
    
    // Optional fields - 10% total
    optional: [
      { key: 'whatsapp_number', label: 'WhatsApp Number', weight: 2 },
      { key: 'address', label: 'Address', weight: 2 },
      { key: 'website_url', label: 'Website', weight: 2 },
      { key: 'instagram_url', label: 'Instagram', weight: 2 },
      { key: 'facebook_url', label: 'Facebook', weight: 2 },
    ]
  };

  // Flatten all fields
  const allFields = [
    ...fields.essential,
    ...fields.important,
    ...fields.optional
  ];

  let totalWeight = 0;
  let completedWeight = 0;
  const missingFields = [];
  const completedFields = [];

  allFields.forEach(field => {
    totalWeight += field.weight;
    
    const value = userData[field.key];
    const isCompleted = value && value !== '' && value !== null && value !== undefined;
    
    if (isCompleted) {
      completedWeight += field.weight;
      completedFields.push(field);
    } else {
      missingFields.push(field);
    }
  });

  const percentage = Math.round((completedWeight / totalWeight) * 100);

  return {
    percentage,
    missingFields,
    completedFields,
    totalFields: allFields.length,
    completedCount: completedFields.length
  };
};

/**
 * Get profile completion color based on percentage
 * @param {number} percentage - Completion percentage
 * @returns {string} - Color code
 */
export const getProfileCompletionColor = (percentage) => {
  if (percentage >= 80) return '#00cc44'; // Green
  if (percentage >= 50) return '#ffaa00'; // Orange
  return '#ff4444'; // Red
};

/**
 * Get profile completion message
 * @param {number} percentage - Completion percentage
 * @returns {string} - Motivational message
 */
export const getProfileCompletionMessage = (percentage) => {
  if (percentage === 100) {
    return 'Your profile is complete! Great job!';
  }
  if (percentage >= 80) {
    return 'Almost there! Just a few more details to go.';
  }
  if (percentage >= 50) {
    return 'You\'re halfway there! Keep going.';
  }
  if (percentage >= 25) {
    return 'Good start! Add more details to stand out.';
  }
  return 'Welcome! Complete your profile to get started.';
};

/**
 * Get next suggested field to complete
 * @param {Array} missingFields - Array of missing fields
 * @returns {Object|null} - Next field to complete
 */
export const getNextSuggestedField = (missingFields) => {
  if (!missingFields || missingFields.length === 0) {
    return null;
  }
  
  // Return the field with highest weight (most important)
  return missingFields.sort((a, b) => b.weight - a.weight)[0];
};

const profileCompletionUtils = {
  calculateProfileCompletion,
  getProfileCompletionColor,
  getProfileCompletionMessage,
  getNextSuggestedField
};

export default profileCompletionUtils;
