import React, { useState, useEffect } from 'react';
import './LoanCalculator.css';

const LoanCalculator = ({ carPrice }) => {
  const [loanAmount, setLoanAmount] = useState(carPrice * 0.8); // Default 80% financing
  const [downPayment, setDownPayment] = useState(carPrice * 0.2); // Default 20% down payment
  const [loanTerm, setLoanTerm] = useState(60); // Default 5 years
  const [interestRate, setInterestRate] = useState(4.5); // Default 4.5% APR
  const [monthlyPayment, setMonthlyPayment] = useState(0);
  const [totalInterest, setTotalInterest] = useState(0);
  const downPaymentPercent = carPrice > 0 ? Math.round((downPayment / carPrice) * 100) : 0;

  // Update loan amount when down payment changes
  useEffect(() => {
    const newLoanAmount = carPrice - downPayment;
    setLoanAmount(Math.max(0, newLoanAmount));
  }, [downPayment, carPrice]);

  // Calculate monthly payment
  useEffect(() => {
    if (loanAmount > 0 && interestRate > 0 && loanTerm > 0) {
      const monthlyRate = interestRate / 100 / 12;
      const numPayments = loanTerm;
      
      const monthlyPaymentCalc = (loanAmount * monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / 
                                (Math.pow(1 + monthlyRate, numPayments) - 1);
      
      const totalPayments = monthlyPaymentCalc * numPayments;
      const totalInterestCalc = totalPayments - loanAmount;
      
      setMonthlyPayment(monthlyPaymentCalc);
      setTotalInterest(totalInterestCalc);
    } else {
      setMonthlyPayment(0);
      setTotalInterest(0);
    }
  }, [loanAmount, interestRate, loanTerm]);

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-AE', {
      style: 'currency',
      currency: 'AED',
      maximumFractionDigits: 0
    }).format(amount);
  };

  const handleDownPaymentChange = (value) => {
    const newDownPayment = Math.min(Math.max(0, value), carPrice);
    setDownPayment(newDownPayment);
  };

  return (
    <div className="loan-calculator-container">
      <div className="calculator-inputs">
        <div className="input-row">
          <div className="input-group">
            <label htmlFor="carPrice">Car Price</label>
            <input
              type="text"
              id="carPrice"
              value={formatCurrency(carPrice)}
              disabled
              className="readonly-input"
            />
          </div>
          <div className="input-group">
            <label htmlFor="downPayment">Down Payment (AED) ({downPaymentPercent}%)</label>
            <input
              type="number"
              id="downPayment"
              value={downPayment}
              onChange={(e) => handleDownPaymentChange(parseFloat(e.target.value) || 0)}
              min="0"
              max={carPrice}
              step="1000"
            />
          </div>
        </div>

        <div className="input-row">
          <div className="input-group">
            <label htmlFor="loanTerm">Loan Term</label>
            <select
              id="loanTerm"
              value={loanTerm}
              onChange={(e) => setLoanTerm(parseInt(e.target.value))}
            >
              <option value={12}>1 year</option>
              <option value={24}>2 years</option>
              <option value={36}>3 years</option>
              <option value={48}>4 years</option>
              <option value={60}>5 years</option>
              <option value={72}>6 years</option>
              <option value={84}>7 years</option>
            </select>
          </div>
          <div className="input-group">
            <label htmlFor="interestRate">Interest Rate (%)</label>
            <input
              type="number"
              id="interestRate"
              value={interestRate}
              onChange={(e) => setInterestRate(parseFloat(e.target.value) || 0)}
              min="0"
              max="20"
              step="0.1"
            />
          </div>
        </div>
      </div>

      <div className="calculator-results">
        <div className="result-card">
          <div className="result-label">Monthly Payment</div>
          <div className="result-value primary">{formatCurrency(monthlyPayment)}</div>
        </div>
        <div className="result-card">
          <div className="result-label">Loan Amount</div>
          <div className="result-value">{formatCurrency(loanAmount)}</div>
        </div>
        <div className="result-card">
          <div className="result-label">Total Interest</div>
          <div className="result-value">{formatCurrency(totalInterest)}</div>
        </div>
      </div>

      <div className="loan-summary">
        <p className="summary-text">
          With a <strong>{formatCurrency(downPayment)}</strong> down payment, 
          your monthly payment would be <strong>{formatCurrency(monthlyPayment)}</strong> 
          for {Math.round(loanTerm / 12)} year(s) at {interestRate}% APR.
        </p>
      </div>
    </div>
  );
};

export default LoanCalculator;
