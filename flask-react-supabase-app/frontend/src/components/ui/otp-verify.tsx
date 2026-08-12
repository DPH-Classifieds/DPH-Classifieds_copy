"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Check, Loader2, ShieldCheck, X } from "lucide-react"
import { motion, useAnimationControls } from "motion/react"

import { cn } from "../../lib/utils"
import { getAccessToken } from "../../utils/supabaseClient"
import { formatVerificationPhone } from "../../utils/countryCodes"
import {
  shouldUseMsg91,
  ensureMsg91Widget,
  toMsg91Identifier,
  msg91SendOtp,
  msg91RetryOtp,
  msg91VerifyOtp,
} from "../../utils/msg91Widget"

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:8000"
// MSG91 widget is configured for 4-digit OTPs; the Infobip flow uses 6.
const OTP_LENGTH_DEFAULT = 6
const OTP_LENGTH_MSG91 = 4
const RESEND_COOLDOWN = 50
const UAE_COUNTRY_CODE = "+971"

const emptyOtp = (len = OTP_LENGTH_DEFAULT) => Array.from({ length: len }, () => "")

// UAE mobile national significant number is 9 digits (5X XXX XXXX). We only send
// an OTP once the number is fully typed — a partial number just burns a send
// attempt against the backend's per-user cap and rate-limits the real number.
const isCompleteUaePhone = (raw) => {
  const digits = String(raw || "").replace(/\D/g, "")
  const national = digits.startsWith("971") ? digits.slice(3) : digits.replace(/^0/, "")
  return national.length === 9
}

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
  // Drives the shake-on-wrong-code animation for the whole digit row.
  const shakeControls = useAnimationControls()

  const closeHandler = onClose || onCancel
  const effectiveCountryCode = UAE_COUNTRY_CODE
  // Route through MSG91 only for numbers in the configured prefix set (default 058);
  // the widget sends & verifies client-side and the backend validates the JWT. All
  // other numbers fall back to the Infobip SMS flow (/start + /verify) unchanged.
  // Decision is per-number and stable between send and verify (phone can't change
  // mid-session without a reset), so start and verify always agree on the path.
  // Backend is authoritative: if /start says a number is MSG91-routed, we honor it
  // even when our own prefix config disagreed. This kills the "code sent, no box"
  // dead-end caused by frontend/backend prefix mismatch.
  const [serverForcedMsg91, setServerForcedMsg91] = useState(false)
  const useMsg91 = shouldUseMsg91(phoneInput || phone) || serverForcedMsg91
  const otpLength = useMsg91 ? OTP_LENGTH_MSG91 : OTP_LENGTH_DEFAULT
  const phoneComplete = isCompleteUaePhone(phoneInput || phone)
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
    setServerForcedMsg91(false)
    setOtp(emptyOtp(otpLength))
    setMessage("")
    setError("")
    setCooldownRemaining(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialVerificationId, phone, purpose, listingId])

  // Keep the input count in sync when the routed provider (and thus OTP length)
  // changes — e.g. the number is edited from an 058 (MSG91, 4) to an 050 (Infobip, 6).
  useEffect(() => {
    setOtp((prev) => (prev.length === otpLength ? prev : emptyOtp(otpLength)))
  }, [otpLength])

  useEffect(() => {
    if (cooldownRemaining <= 0) return
    const timer = window.setInterval(() => {
      setCooldownRemaining((prev) => Math.max(0, prev - 1))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [cooldownRemaining])

  // Auto-verify once the full code is entered (reference UX: no explicit button).
  useEffect(() => {
    if (hasSession && !verified && !loading && !starting && otp.join("").length === otpLength) {
      void verifyCode()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp])

  useEffect(() => {
    if (!open || verified || !initialVerificationId) return
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
  }, [initialVerificationId, listingId, open, phone, purpose, verified])

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
      const chars = digits.slice(0, otpLength - index).split("")
      chars.forEach((char, offset) => {
        next[index + offset] = char
      })
      return next
    })

    const nextFocus = Math.min(index + digits.length, otpLength - 1)
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
    if (event.key === "ArrowRight" && index < otpLength - 1) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  const startVerification = async (allowStaleRetry = true) => {
    // Fresh send (no session yet) must have a complete number. Resends reuse the
    // existing verificationId, so they're exempt.
    if (!verificationId && !isCompleteUaePhone(phoneInput)) {
      setError("Enter your full UAE mobile number.")
      return
    }
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
      // Backend routed this number to the MSG91 widget (no server SMS, no id).
      // Honor it: run the widget send so the code UI appears, instead of a dead
      // "code sent" with no input box.
      if (!nextVerificationId && data.phone_verification?.provider === "msg91_widget") {
        await ensureMsg91Widget()
        await msg91SendOtp(toMsg91Identifier(phoneInput))
        setServerForcedMsg91(true)
        setVerificationId("msg91")
        setPhoneVerification(data.phone_verification)
        setMessage("Verification code sent.")
        setCooldownRemaining(RESEND_COOLDOWN)
        return
      }
      if (!nextVerificationId) {
        throw new Error("Verification could not be started. Please try again.")
      }
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

  const verifyCode = async (event?) => {
    if (event) {
      event.preventDefault()
    }

    setLoading(true)
    setError("")
    setMessage("")

    try {
      const code = otp.join("")
      if (code.length !== otpLength) {
        throw new Error(`Enter the ${otpLength}-digit code`)
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
      // Shake the row and clear it so the user can retype immediately.
      void shakeControls.start({
        x: [0, -9, 8, -6, 5, 0],
        transition: { duration: 0.4, ease: "easeInOut" },
      })
      setOtp(emptyOtp(otpLength))
      window.requestAnimationFrame(() => inputRefs.current[0]?.focus())
    } finally {
      setLoading(false)
    }
  }

  const handlePaste = (event) => {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, otpLength)
    if (!pasted) return
    event.preventDefault()
    setOtp(() => {
      const next = emptyOtp(otpLength)
      pasted.split("").forEach((digit, index) => {
        next[index] = digit
      })
      return next
    })
    window.requestAnimationFrame(() => {
      inputRefs.current[Math.min(pasted.length, otpLength - 1)]?.focus()
    })
  }

  if (!open && mode === "modal") {
    return null
  }

  // A session exists once the code has been sent — drives the two-step UI
  // (enter number → enter code) instead of showing everything at once.
  const hasSession = Boolean(verificationId)

  const changeNumber = () => {
    setVerificationId(null)
    setPhoneVerification(null)
    setOtp(emptyOtp(otpLength))
    setMessage("")
    setError("")
    setCooldownRemaining(0)
    window.requestAnimationFrame(() => {
      document.getElementById("phone-verification-phone")?.focus()
    })
  }

  const busy = loading || starting

  const codeInputs = (
    <motion.div animate={shakeControls} className="flex items-center justify-center gap-2.5 sm:gap-3">
      {otp.map((digit, index) => (
        <motion.input
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
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 700, damping: 22, delay: index * 0.05 }}
          whileFocus={{ y: -4, scale: 1.05 }}
          className={cn(
            "rounded-2xl border text-center font-semibold text-white caret-[#8bd6b4] outline-none transition-colors duration-150",
            otpLength <= 4 ? "h-16 w-14 text-3xl" : "h-14 w-11 text-2xl",
            "focus:border-[#8bd6b4]/70 focus:bg-white/[0.08] focus:shadow-[0_0_0_4px_rgba(139,214,180,0.18)]",
            digit ? "border-[#8bd6b4]/50 bg-white/[0.07]" : "border-white/10 bg-white/[0.03]"
          )}
        />
      ))}
    </motion.div>
  )

  const body = (
    <form className={cn("phone-verification-flow", className)} onSubmit={verifyCode}>
      <div className="relative mx-auto w-full max-w-md rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,28,19,0.98)_0%,rgba(7,15,10,0.98)_100%)] p-7 text-white shadow-[0_30px_80px_-24px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.04)] sm:p-9">
        {!hideClose && closeHandler ? (
          <button
            type="button"
            onClick={closeHandler}
            aria-label="Close verification"
            className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/60 transition hover:bg-white/[0.08] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}

        {verified ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <motion.div
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 22 }}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-[#8bd6b4] text-[#05100a] ring-8 ring-[#8bd6b4]/12"
            >
              <Check className="h-8 w-8" strokeWidth={3} />
            </motion.div>
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.3 }}
              className="text-xl font-semibold text-white"
            >
              Phone verified
            </motion.p>
            <p className="text-sm text-white/60">{message || "You're all set."}</p>
          </div>
        ) : !hasSession ? (
          <div className="flex flex-col items-center text-center animate-in fade-in duration-200">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-[#8bd6b4]/20 bg-[#0e2418] text-[#8bd6b4] ring-4 ring-[#8bd6b4]/10">
              <ShieldCheck className="h-8 w-8" />
            </div>
            <h3 id="otp-verification-title" className="text-2xl font-semibold tracking-[-0.03em] text-white">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-white/60">
              Check the number below before we send your verification code.
            </p>
            <input
              id="phone-verification-phone"
              type="tel"
              value={phoneInput}
              onChange={(event) => setPhoneInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && phoneComplete && !busy) {
                  event.preventDefault()
                  void sendOrResend()
                }
              }}
              placeholder="+971 50 123 4567"
              autoComplete="tel"
              autoFocus
              className="mt-6 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3.5 text-center text-base text-white outline-none transition placeholder:text-white/30 focus:border-[#8bd6b4]/40 focus:bg-white/[0.06] focus:shadow-[0_0_0_4px_rgba(139,214,180,0.12)]"
            />
            {phoneComplete ? (
              <p className="mt-3 text-sm leading-5 text-white/65">
                We&apos;ll send an OTP to <span className="font-semibold text-white">{displayPhone}</span>.
              </p>
            ) : null}
            <div className="mt-2 h-5 text-sm font-medium text-[#ffb3b3]">{error || ""}</div>
            <button
              type="button"
              className="auth-button primary-button mt-2 w-full"
              onClick={sendOrResend}
              disabled={busy || !phoneComplete}
            >
              {busy ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending code...
                </span>
              ) : (
                `Send OTP to ${displayPhone || "this number"}`
              )}
            </button>
            {!hideClose && closeHandler ? (
              <button
                type="button"
                onClick={closeHandler}
                className="mt-3 text-xs text-white/45 transition hover:text-white/70"
              >
                Cancel
              </button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col items-center text-center animate-in fade-in duration-200">
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
              className="mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-[#8bd6b4]/20 bg-[#0e2418] text-[#8bd6b4] ring-4 ring-[#8bd6b4]/10"
            >
              <ShieldCheck className="h-8 w-8" />
            </motion.div>
            <h3 id="otp-verification-title" className="text-2xl font-semibold tracking-[-0.03em] text-white">
              Enter verification code
            </h3>
            <p className="mt-2 text-sm leading-6 text-white/60">
              We sent a {otpLength}-digit code to
              <br />
              <span className="font-semibold text-white">{displayPhone || "your phone"}</span>
            </p>

            <div className="mt-7">{codeInputs}</div>

            <div className="mt-3 h-5 text-sm font-medium text-[#ffb3b3]">{error || ""}</div>

            {loading ? (
              <div className="inline-flex items-center gap-2 text-sm text-[#bfeac8]">
                <Loader2 className="h-4 w-4 animate-spin" /> Verifying...
              </div>
            ) : null}

            <div className="mt-5 text-sm text-white/55">
              Didn&apos;t get a code?{" "}
              {cooldownRemaining > 0 ? (
                <span className="text-white/40">Resend in {cooldownRemaining}s</span>
              ) : (
                <button
                  type="button"
                  onClick={sendOrResend}
                  disabled={busy}
                  className="font-semibold text-[#bfeac8] transition hover:underline disabled:opacity-40"
                >
                  Click to resend
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={changeNumber}
              disabled={busy}
              className="mt-3 text-xs text-white/45 transition hover:text-white/70 disabled:opacity-40"
            >
              Change number
            </button>
          </div>
        )}
      </div>
    </form>
  )

  if (mode === "page") {
    // The OTP `body` is already a self-contained card — render it directly in the
    // centered auth shell (no second wrapper card) so it stays centered on any
    // width, including ultrawide.
    return (
      <div className="auth-container">
        <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-2 duration-300">
          {body}
        </div>
      </div>
    )
  }

  // Portal to <body> so the fixed backdrop is always viewport-relative and can't
  // be shifted off-centre by a transformed/filtered ancestor of the mount point.
  return createPortal(
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
    </div>,
    document.body
  )
}

export default OTPVerification
