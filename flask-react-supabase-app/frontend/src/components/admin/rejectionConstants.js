export const LISTING_REJECTION_REASONS = [
  {
    reason: 'Incomplete listing information',
    fix: 'Please fill in all required fields including make, model, year, price, and description. Add more details about the vehicle condition and specifications.',
  },
  {
    reason: 'Duplicate listing',
    fix: 'You already have an active listing for this vehicle. Please delete the duplicate or contact support if this is an error.',
  },
  {
    reason: 'Fraud or suspicious activity',
    fix: 'This listing has been flagged for suspicious activity. Please verify your identity and ensure the listing details match the actual vehicle. Contact support if you believe this is an error.',
  },
  {
    reason: 'Prohibited or inappropriate content',
    fix: 'The listing contains content that violates our guidelines. Please remove any prohibited material, offensive language, or misleading information and resubmit.',
  },
  {
    reason: 'Poor image quality',
    fix: 'Please upload clear, well-lit photos of the vehicle. Include images of the exterior, interior, dashboard, and any damage. Minimum resolution: 800x600.',
  },
  {
    reason: 'Incorrect pricing',
    fix: 'The listed price appears incorrect or misleading. Please update to reflect the actual selling price of the vehicle. Price must be in AED.',
  },
  {
    reason: 'Missing contact details',
    fix: 'Please provide a valid phone number and email address so buyers can reach you. Your contact information must be current and accurate.',
  },
  {
    reason: 'Expired or outdated information',
    fix: 'The listing details appear outdated. Please update the vehicle information, price, and availability to reflect current status.',
  },
];

export const DEALER_REJECTION_REASONS = [
  {
    reason: 'Incomplete registration details',
    fix: 'Please complete all required business fields in your profile: company name, registration number, trade license number, and TRN. Then re-submit for verification.',
  },
  {
    reason: 'Expired or invalid trade license',
    fix: 'Your trade license appears expired or invalid. Please upload a current, valid trade license document in Account Settings > Business Details, then re-submit.',
  },
  {
    reason: 'Unverifiable business information',
    fix: 'We could not verify your business details. Please ensure your company registration number and trade license match official records. Upload supporting documents if available.',
  },
  {
    reason: 'Business not active in UAE',
    fix: 'Your business must be registered and active in the UAE to be verified as a dealer on DPH Classifieds. Please update your business details accordingly.',
  },
  {
    reason: 'Missing required documents',
    fix: 'Please upload your trade license, company registration certificate, and tax registration document in Account Settings > Business Details. Accepted formats: JPG, PNG, PDF.',
  },
  {
    reason: 'Fraudulent or misleading information',
    fix: 'The information provided does not match official records. Please update your business details to accurately reflect your company information and re-submit for verification.',
  },
];
