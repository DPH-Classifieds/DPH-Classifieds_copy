"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { KeyRound, Loader2, RefreshCw, ShieldCheck, X } from "lucide-react"

import { cn } from "../../lib/utils"
import { getAccessToken } from "../../utils/supabaseClient"
import { formatVerificationPhone } from "../../utils/countryCodes"
import {
  isMsg91Enabled,
  ensureMsg91Widget,
  toMsg91Identifier,
  msg91SendOtp,
  msg91RetryOtp,
  msg91VerifyOtp,
} from "../../utils/msg91Widget"

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:8000"
const OTP_LENGTH = 6
const RESEND_COOLDOWN = 50
const UAE_COUNTRY_CODE = "+971"

const emptyOtp = () => Array.from({ length: OTP_LENGTH }, () => "")

export function OTPVerification({
  mode = "modal",
  open = true,
  title = "Verify your phone",
  description = "We sent a one-time code to your phone number.",
  phone,
  countryCode: _countryCode,
  purpose = "vin_reveal",
  listingId,
  verificationId: initialVerificationId = null,
  onClose,
  onVerified,
  onCancel,
  autoStart = true,
  hideClose = false,
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
  // ponytail: fire auto-start at most once per context; failed starts must NOT
  // re-trigger the effect (that caused the /start request storm → 400s then 429s).
  const autoStartedRef = useRef(false)

  const closeHandler = onClose || onCancel
  const effectiveCountryCode = UAE_COUNTRY_CODE
  // When MSG91 is configured, the widget sends & verifies the OTP client-side and
  // the backend only validates the returned JWT. Otherwise fall back to the
  // Infobip SMS flow (/start + /verify) unchanged.
  const useMsg91 = isMsg91Enabled()
  const displayPhone = useMemo(() => {
    return (
      phoneVerification?.masked_phone
      || (phoneInput || phone ? formatVerificationPhone(phoneInput || phone, effectiveCountryCode) : "")
    )
  }, [effectiveCountryCode, phone, phoneInput, phoneVerification?.masked_phone])

  useEffect(() => {
    setVerificationId(initialVerificationId)
    setPhoneInput(phone || "")
    setPhoneVerification(null)
    setVerified(false)
    setOtp(emptyOtp())
    setMessage("")
    setError("")
    setCooldownRemaining(0)
    autoStartedRef.current = false
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

    if (!autoStart || !phoneInput || starting || verificationId || autoStartedRef.current) {
      return
    }

    autoStartedRef.current = true
    void startVerification()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    autoStart,
    phoneInput,
    phone,
    effectiveCountryCode,
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

  const startVerification = async (allowStaleRetry = true) => {
    setStarting(true)
    setError("")
    setMessage("Sending verification code...")

    if (useMsg91) {
      try {
        await ensureMsg91Widget()
        // Resend if a session already exists, otherwise a fresh send.
        if (verificationId) await msg91RetryOtp(null)
        else await msg91SendOtp(toMsg91Identifier(phoneInput))
        setVerificationId((prev) => prev || "msg91")
        setPhoneVerification((prev) => prev || {
          verification_id: "msg91",
          phone: phoneInput,
          purpose,
          listing_id: listingId,
          status: "pending",
          masked_phone: phoneInput ? `***${String(phoneInput).slice(-4)}` : null,
        })
        setMessage("Verification code sent.")
        setCooldownRemaining(RESEND_COOLDOWN)
      } catch (sendError: any) {
        setError(sendError?.message || sendError?.type || "Failed to send verification code")
      } finally {
        setStarting(false)
      }
      return
    }

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
                country_code: UAE_COUNTRY_CODE,
                purpose,
                listing_id: listingId,
                source: mode,
              }
        ),
      })

      const data = await response.json()
      if (!response.ok) {
        if (
          response.status === 403
          && allowStaleRetry
          && verificationId
          && (data?.message || "").toLowerCase().includes("cannot resend")
        ) {
          setVerificationId(null)
          setPhoneVerification(null)
          await startVerification(false)
          return
        }
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
      // MSG91: verify the code with the widget, then hand the JWT to the backend
      // to validate + run the verified-phone side-effects.
      const accessToken = useMsg91 ? await msg91VerifyOtp(code) : null

      const endpoint = useMsg91
        ? "/api/phone-verifications/verify-token"
        : "/api/phone-verifications/verify"
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(
          useMsg91
            ? {
                access_token: accessToken,
                phone: phoneInput,
                country_code: UAE_COUNTRY_CODE,
                purpose,
                listing_id: listingId,
              }
            : {
                verification_id: verificationId,
                code,
                purpose,
                listing_id: listingId,
              }
        ),
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

  // A session exists once the code has been sent — drives the two-step UI
  // (enter number → enter code) instead of showing everything at once.
  const hasSession = Boolean(verificationId)

  const changeNumber = () => {
    autoStartedRef.current = true // stay manual; don't auto-resend to the old number
    setVerificationId(null)
    setPhoneVerification(null)
    setOtp(emptyOtp())
    setMessage("")
    setError("")
    setCooldownRemaining(0)
    window.requestAnimationFrame(() => {
      document.getElementById("phone-verification-phone")?.focus()
    })
  }

  const busy = loading || starting

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
            "aspect-square w-full rounded-2xl border text-center text-xl font-semibold text-white outline-none transition-all duration-150",
            "focus:border-[#8bd6b4]/60 focus:bg-white/[0.07] focus:shadow-[0_0_0_4px_rgba(139,214,180,0.15)] focus:scale-[1.04]",
            digit ? "border-[#8bd6b4]/40 bg-white/[0.06]" : "border-white/10 bg-white/[0.03]"
          )}
        />
      ))}
    </div>
  )

  const cancelButton =
    !hideClose && closeHandler ? (
      <button type="button" className="auth-button auth-button-secondary" onClick={closeHandler}>
        Cancel
      </button>
    ) : null

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
            <p className="mt-2 text-xs leading-5 text-[#bfeac8]">OTP is supported for UAE numbers only (+971).</p>
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

        {verified ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#8bd6b4]/20 bg-[#0d2217] px-4 py-8 text-center animate-in fade-in zoom-in-95 duration-200">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#8bd6b4]/15 text-[#8bd6b4]">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <p className="text-base font-semibold text-white">Phone verified</p>
            <p className="text-sm text-white/60">{message || "You're all set."}</p>
          </div>
        ) : !hasSession ? (
          <div className="space-y-4 animate-in fade-in duration-200">
            <div>
              <label htmlFor="phone-verification-phone" className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-white/55">
                Phone number
              </label>
              <input
                id="phone-verification-phone"
                type="tel"
                value={phoneInput}
                onChange={(event) => setPhoneInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && phoneInput && !busy) {
                    event.preventDefault()
                    void sendOrResend()
                  }
                }}
                placeholder="+971 50 123 4567"
                autoComplete="tel"
                autoFocus
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3.5 text-base text-white outline-none transition placeholder:text-white/30 focus:border-[#8bd6b4]/40 focus:bg-white/[0.06] focus:shadow-[0_0_0_4px_rgba(139,214,180,0.12)]"
              />
              <p className="mt-2 text-xs leading-5 text-white/45">
                Enter it however you like — we normalize it before sending the SMS.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <button
                type="button"
                className="auth-button primary-button"
                onClick={sendOrResend}
                disabled={busy || !phoneInput}
              >
                {busy ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending code...
                  </span>
                ) : (
                  "Send code"
                )}
              </button>
              {cancelButton}
            </div>
          </div>
        ) : (
          <div className="space-y-5 animate-in fade-in slide-in-from-bottom-1 duration-200">
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#8bd6b4]/12 bg-[#0b1a12] px-4 py-3">
              <div className="min-w-0">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">Code sent to</span>
                <strong className="mt-0.5 block break-all text-base font-semibold text-white">{displayPhone || "your phone"}</strong>
              </div>
              <button
                type="button"
                onClick={changeNumber}
                disabled={busy}
                className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-[#bfeac8] transition hover:bg-white/[0.06] hover:text-white disabled:opacity-40"
              >
                Change
              </button>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-white/55">
                  Enter the 6-digit code
                </span>
                <button
                  type="button"
                  onClick={sendOrResend}
                  disabled={busy || cooldownRemaining > 0}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#bfeac8] transition hover:text-white disabled:text-white/35"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", starting && "animate-spin")} />
                  {cooldownRemaining > 0 ? `Resend in ${cooldownRemaining}s` : "Resend"}
                </button>
              </div>
              {codeInputs}
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <button
                type="submit"
                className="auth-button primary-button"
                disabled={loading || otp.join("").length !== OTP_LENGTH}
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Verifying...
                  </span>
                ) : (
                  "Verify code"
                )}
              </button>
              {cancelButton}
            </div>
          </div>
        )}

        <div className="mt-6 border-t border-white/10 pt-4 text-xs leading-5 text-white/45">
          By continuing, you confirm this phone number belongs to your account.
        </div>
      </div>
    </form>
  )

  if (mode === "page") {
    return (
      <div className="auth-container">
        <div className="auth-card check-email-card max-w-[620px] animate-in fade-in slide-in-from-bottom-2 duration-300">
          {body}
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-xl animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="otp-verification-title"
      onClick={closeHandler}
    >
      <div
        className="w-full max-w-2xl animate-in fade-in zoom-in-95 duration-200"
        onClick={(event) => event.stopPropagation()}
      >
        {body}
      </div>
    </div>
  )
}

export default OTPVerification
