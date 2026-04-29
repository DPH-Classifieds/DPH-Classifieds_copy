"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { KeyRound, Loader2, RefreshCw, ShieldCheck, X } from "lucide-react"

import { cn } from "../../lib/utils"
import { getAccessToken } from "../../utils/supabaseClient"
import { formatVerificationPhone } from "../../utils/countryCodes"

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:8000"
const OTP_LENGTH = 6
const RESEND_COOLDOWN = 50

const emptyOtp = () => Array.from({ length: OTP_LENGTH }, () => "")

export function OTPVerification({
  mode = "modal",
  open = true,
  title = "Verify your phone",
  description = "We sent a one-time code to your phone number.",
  phone,
  countryCode,
  purpose = "vin_reveal",
  listingId,
  verificationId: initialVerificationId = null,
  onClose,
  onVerified,
  onCancel,
  autoStart = true,
  hideClose = false,
  continueLabel = "Continue",
  className = "",
}) {
  const [verificationId, setVerificationId] = useState(initialVerificationId)
  const [phoneInput, setPhoneInput] = useState(phone || "")
  const [otp, setOtp] = useState(emptyOtp)
  const [loading, setLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [phoneVerification, setPhoneVerification] = useState(null)
  const [verified, setVerified] = useState(false)
  const [cooldownRemaining, setCooldownRemaining] = useState(0)
  const inputRefs = useRef([])

  const closeHandler = onClose || onCancel
  const displayPhone = useMemo(() => {
    return (
      phoneVerification?.masked_phone
      || (phoneInput || phone ? formatVerificationPhone(phoneInput || phone, countryCode) : "")
    )
  }, [countryCode, phone, phoneInput, phoneVerification?.masked_phone])

  useEffect(() => {
    setVerificationId(initialVerificationId)
    setPhoneInput(phone || "")
    setPhoneVerification(null)
    setVerified(false)
    setOtp(emptyOtp())
    setMessage("")
    setError("")
    setCooldownRemaining(0)
  }, [initialVerificationId, phone, purpose, listingId])

  useEffect(() => {
    if (cooldownRemaining <= 0) return
    const timer = window.setInterval(() => {
      setCooldownRemaining((prev) => Math.max(0, prev - 1))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [cooldownRemaining])

  useEffect(() => {
    if (!open || verified) return

    if (initialVerificationId) {
      setPhoneVerification(
        (prev) =>
          prev || {
            verification_id: initialVerificationId,
            phone,
            purpose,
            listing_id: listingId,
            status: "pending",
            masked_phone: phone ? `***${String(phone).slice(-4)}` : null,
          }
      )
      return
    }

    if (!autoStart || !phoneInput || starting || verificationId) {
      return
    }

    void startVerification()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    autoStart,
    phoneInput,
    phone,
    countryCode,
    purpose,
    listingId,
    starting,
    verificationId,
    verified,
    initialVerificationId,
  ])

  useEffect(() => {
    if (!open || verified) return
    const firstEmpty = otp.findIndex((digit) => !digit)
    if (firstEmpty >= 0) {
      inputRefs.current[firstEmpty]?.focus()
    }
  }, [open, verified, otp])

  const applyDigits = (index, rawValue) => {
    const digits = String(rawValue || "").replace(/\D/g, "")
    if (!digits) {
      setOtp((prev) => {
        const next = [...prev]
        next[index] = ""
        return next
      })
      return
    }

    setOtp((prev) => {
      const next = [...prev]
      const chars = digits.slice(0, OTP_LENGTH - index).split("")
      chars.forEach((char, offset) => {
        next[index + offset] = char
      })
      return next
    })

    const nextFocus = Math.min(index + digits.length, OTP_LENGTH - 1)
    window.requestAnimationFrame(() => {
      inputRefs.current[nextFocus]?.focus()
    })
  }

  const handleKeyDown = (index, event) => {
    if (event.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
    if (event.key === "ArrowLeft" && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
    if (event.key === "ArrowRight" && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  const startVerification = async () => {
    setStarting(true)
    setError("")
    setMessage("Sending verification code...")

    try {
      const token = await getAccessToken()
      const response = await fetch(`${API_URL}/api/phone-verifications/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(
          verificationId
            ? { verification_id: verificationId, source: mode }
            : {
                phone: phoneInput,
                country_code: countryCode,
                purpose,
                listing_id: listingId,
                source: mode,
              }
        ),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.message || "Failed to send verification code")
      }

      if (data.already_verified) {
        setVerified(true)
        setMessage("Phone is already verified.")
        if (onVerified) onVerified(data)
        return
      }

      const nextVerificationId = data.phone_verification?.verification_id || null
      setVerificationId(nextVerificationId || verificationId)
      setPhoneVerification(data.phone_verification || null)
      setMessage("Verification code sent.")
      setCooldownRemaining(RESEND_COOLDOWN)
    } catch (sendError) {
      setError(sendError?.message || "Failed to send verification code")
    } finally {
      setStarting(false)
    }
  }

  const sendOrResend = async () => {
    setLoading(true)
    setError("")
    setMessage("")

    try {
      await startVerification()
    } finally {
      setLoading(false)
    }
  }

  const verifyCode = async (event) => {
    if (event) {
      event.preventDefault()
    }

    setLoading(true)
    setError("")
    setMessage("")

    try {
      const code = otp.join("")
      if (code.length !== OTP_LENGTH) {
        throw new Error(`Enter the ${OTP_LENGTH}-digit code`)
      }

      const token = await getAccessToken()
      const response = await fetch(`${API_URL}/api/phone-verifications/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          verification_id: verificationId,
          code,
          purpose,
          listing_id: listingId,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.message || "Failed to verify code")
      }

      setVerified(true)
      setMessage("Phone verified successfully.")
      if (onVerified) {
        onVerified(data)
      }
    } catch (verifyError) {
      setError(verifyError?.message || "Failed to verify code")
    } finally {
      setLoading(false)
    }
  }

  const handlePaste = (event) => {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH)
    if (!pasted) return
    event.preventDefault()
    setOtp(() => {
      const next = emptyOtp()
      pasted.split("").forEach((digit, index) => {
        next[index] = digit
      })
      return next
    })
    window.requestAnimationFrame(() => {
      inputRefs.current[Math.min(pasted.length, OTP_LENGTH - 1)]?.focus()
    })
  }

  if (!open && mode === "modal") {
    return null
  }

  const codeInputs = (
    <div className="grid grid-cols-6 gap-2 sm:gap-3">
      {otp.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            inputRefs.current[index] = el
          }}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          value={digit}
          onChange={(event) => applyDigits(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          maxLength={1}
          aria-label={`Verification digit ${index + 1}`}
          className={cn(
            "h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] text-center text-lg font-semibold text-white outline-none transition",
            "placeholder:text-white/20 focus:border-[#8bd6b4]/40 focus:bg-white/[0.06] focus:shadow-[0_0_0_4px_rgba(139,214,180,0.12)]",
            digit ? "border-[#8bd6b4]/25" : ""
          )}
        />
      ))}
    </div>
  )

  const body = (
    <form className={cn("phone-verification-flow", className)} onSubmit={verifyCode}>
      <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,28,19,0.98)_0%,rgba(7,15,10,0.98)_100%)] p-6 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:p-8">
        <div className="mb-6 flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#8bd6b4]/20 bg-[#0e2418] text-[#8bd6b4]">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#8bd6b4]/15 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#bfeac8]">
              <KeyRound className="h-3.5 w-3.5" />
              Secure verification
            </div>
            <h3 id="otp-verification-title" className="text-2xl font-semibold tracking-[-0.04em] text-white">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-white/65">{description}</p>
          </div>
          {!hideClose && closeHandler ? (
            <button
              type="button"
              onClick={closeHandler}
              aria-label="Close verification"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/70 transition hover:bg-white/[0.08] hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {displayPhone ? (
          <div className="mb-5 rounded-2xl border border-[#8bd6b4]/12 bg-[#0b1a12] px-4 py-3">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
              Sent to
            </span>
            <strong className="mt-1 block break-all text-base font-semibold text-white">{displayPhone}</strong>
          </div>
        ) : null}

        {message ? (
          <div className="mb-4 rounded-2xl border border-[#8bd6b4]/12 bg-[#0d2217] px-4 py-3 text-sm text-[#c8f0d2]">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="mb-4 rounded-2xl border border-[#ff8f8f]/20 bg-[rgba(107,23,23,0.5)] px-4 py-3 text-sm text-[#ffb3b3]">
            {error}
          </div>
        ) : null}

        <div className="space-y-4">
          <div>
            <label htmlFor="phone-verification-phone" className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-white/55">
              Phone number
            </label>
            <input
              id="phone-verification-phone"
              type="tel"
              value={phoneInput}
              onChange={(event) => setPhoneInput(event.target.value)}
              placeholder="+971501234567 or 0501234567"
              autoComplete="tel"
              className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3.5 text-base text-white outline-none transition placeholder:text-white/30 focus:border-[#8bd6b4]/40 focus:bg-white/[0.06] focus:shadow-[0_0_0_4px_rgba(139,214,180,0.12)]"
            />
            <p className="mt-2 text-xs leading-5 text-white/45">
              Enter the number however you normally write it. We normalize it before sending the SMS.
            </p>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-white/55">
                Verification code
              </span>
              <span className="text-xs text-white/40">6 digits</span>
            </div>
            {codeInputs}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {!hideClose && closeHandler ? (
              <button
                type="button"
                className="auth-button auth-button-secondary"
                onClick={closeHandler}
              >
                Cancel
              </button>
            ) : null}

            {!verified ? (
              <button
                type="button"
                className="auth-button auth-button-secondary"
                onClick={sendOrResend}
                disabled={loading || starting || cooldownRemaining > 0}
              >
                {cooldownRemaining > 0 ? `Resend in ${cooldownRemaining}s` : verificationId ? "Resend code" : "Send code"}
              </button>
            ) : null}

            <button
              type="submit"
              className="auth-button primary-button"
              disabled={loading || verified || otp.join("").length !== OTP_LENGTH}
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verifying...
                </span>
              ) : verified ? (
                continueLabel
              ) : (
                "Verify code"
              )}
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-white/10 pt-4 text-xs text-white/45">
          <span>By continuing, you confirm this phone belongs to your account.</span>
          <button
            type="button"
            className="inline-flex items-center gap-2 font-semibold text-[#bfeac8] transition hover:text-white"
            onClick={sendOrResend}
            disabled={loading || starting || cooldownRemaining > 0}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {cooldownRemaining > 0 ? `Wait ${cooldownRemaining}s` : verificationId ? "Resend code" : "Send code"}
          </button>
        </div>
      </div>
    </form>
  )

  if (mode === "page") {
    return (
      <div className="auth-container">
        <div className="auth-card check-email-card max-w-[620px]">
          {body}
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="otp-verification-title"
      onClick={closeHandler}
    >
      <div
        className="w-full max-w-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {body}
      </div>
    </div>
  )
}

export default OTPVerification
