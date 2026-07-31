// MSG91 OTP widget loader (client side of the two-sided widget flow).
//
// exposeMethods:true keeps our own OTP UI — MSG91 does NOT render a popup; it only
// exposes window.sendOtp / retryOtp / verifyOtp. On verify the widget hands us a
// JWT which the backend validates via /api/phone-verifications/verify-token.
//
// Gated by env: if REACT_APP_MSG91_WIDGET_ID is unset, isMsg91Enabled() is false and
// callers fall back to the existing Infobip SMS flow. No env = no behaviour change.

const WIDGET_ID = process.env.REACT_APP_MSG91_WIDGET_ID
const TOKEN_AUTH = process.env.REACT_APP_MSG91_TOKEN_AUTH
const SCRIPT_SRC = "https://verify.msg91.com/otp-provider.js"

let initPromise = null

export const isMsg91Enabled = () => Boolean(WIDGET_ID && TOKEN_AUTH)

// Convert any UAE input into MSG91's identifier format: country code, digits only,
// no '+'. e.g. "+971 50 123 4567" / "0501234567" -> "971501234567".
export const toMsg91Identifier = (raw) => {
  let digits = String(raw || "").replace(/\D/g, "")
  if (digits.startsWith("971")) return digits
  digits = digits.replace(/^0+/, "")
  return `971${digits}`
}

// Load the script + call initSendOTP once; resolve when window.sendOtp exists.
export const ensureMsg91Widget = () => {
  if (!isMsg91Enabled()) {
    return Promise.reject(new Error("MSG91 widget is not configured"))
  }
  if (typeof window !== "undefined" && typeof window.sendOtp === "function") {
    return Promise.resolve()
  }
  if (initPromise) return initPromise

  initPromise = new Promise((resolve, reject) => {
    const init = () => {
      try {
        window.initSendOTP({
          widgetId: WIDGET_ID,
          tokenAuth: TOKEN_AUTH,
          exposeMethods: true,
          success: () => {},
          failure: () => {},
        })
      } catch (err) {
        reject(err)
        return
      }
      // initSendOTP wires window.sendOtp synchronously, but guard with a short poll.
      let tries = 0
      const check = () => {
        if (typeof window.sendOtp === "function") return resolve()
        if (tries++ > 50) return reject(new Error("MSG91 methods never exposed"))
        window.setTimeout(check, 100)
      }
      check()
    }

    const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`)
    if (existing) {
      if (typeof window.initSendOTP === "function") init()
      else existing.addEventListener("load", init, { once: true })
      return
    }
    const script = document.createElement("script")
    script.src = SCRIPT_SRC
    script.async = true
    script.onload = init
    script.onerror = () => reject(new Error("Failed to load MSG91 widget script"))
    document.body.appendChild(script)
  }).catch((err) => {
    initPromise = null // allow retry on transient load failure
    throw err
  })

  return initPromise
}

// Promise wrappers around the callback-style window methods.
export const msg91SendOtp = (identifier) =>
  new Promise((resolve, reject) =>
    window.sendOtp(identifier, resolve, reject)
  )

export const msg91RetryOtp = (channel = null) =>
  new Promise((resolve, reject) =>
    window.retryOtp(channel, resolve, reject)
  )

// Resolves with the verified access token (JWT) pulled from MSG91's success payload.
export const msg91VerifyOtp = (otp) =>
  new Promise((resolve, reject) =>
    window.verifyOtp(
      otp,
      (data) => {
        const token =
          data?.message || data?.["access-token"] || data?.accessToken || data
        if (token && typeof token === "string") resolve(token)
        else reject(new Error("No access token returned by MSG91"))
      },
      reject
    )
  )
