import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { OTPVerification } from "./otp-verify";

// ponytail: mock the heavy deps so we only exercise the auto-start loop guard.
jest.mock("../../utils/supabaseClient", () => ({ getAccessToken: async () => "tok" }));
jest.mock("../../utils/countryCodes", () => ({ formatVerificationPhone: (p) => p }));

describe("OTPVerification auto-start", () => {
  afterEach(() => { jest.restoreAllMocks(); });

  test("a failed auto-start does not loop (fires /start exactly once)", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: "OTP is supported for UAE numbers only" }),
    });
    global.fetch = fetchMock;

    // Complete UAE number so auto-start actually fires; the backend still rejects
    // it here (mocked 400) so we can assert the failed start fires exactly once.
    render(<OTPVerification mode="page" phone="+971501234567" purpose="profile_verify" autoStart />);

    // Wait for the error from the single failed attempt to render.
    await screen.findByText(/UAE numbers only/i);
    // Give any stray re-renders a chance to (wrongly) re-fire.
    await new Promise((r) => setTimeout(r, 50));

    const startCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/phone-verifications/start"));
    expect(startCalls).toHaveLength(1);
  });

  test("autoStart=false never auto-fires /start (OAuth waits for the user)", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    render(<OTPVerification mode="page" phone="+971501234567" purpose="profile_verify" autoStart={false} />);
    await new Promise((r) => setTimeout(r, 50));

    const startCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/phone-verifications/start"));
    expect(startCalls).toHaveLength(0);
  });

  test("code inputs stay hidden until a code is sent, then appear (two-step UX)", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ phone_verification: { verification_id: "v1", masked_phone: "***4567" } }),
    });

    render(<OTPVerification mode="page" phone="+971501234567" purpose="profile_verify" autoStart={false} />);

    // Step 1: only the phone field is present — no 6-digit grid.
    expect(screen.getAllByRole("textbox")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /send code/i }));

    // Step 2: the 6 OTP inputs appear once a code has been sent.
    await waitFor(() => expect(screen.getAllByRole("textbox")).toHaveLength(6));
    expect(screen.getByText(/we sent a .*code to/i)).toBeInTheDocument();
  });

  test("Send is disabled and never fires for a partial number, enabled once complete", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    render(<OTPVerification mode="page" purpose="profile_verify" autoStart={false} />);

    const phoneField = screen.getByRole("textbox");
    const sendBtn = screen.getByRole("button", { name: /send code/i });

    // Partial UAE number -> button disabled, no /start call even if forced.
    fireEvent.change(phoneField, { target: { value: "+9715012" } });
    expect(sendBtn).toBeDisabled();
    fireEvent.click(sendBtn);
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMock).not.toHaveBeenCalled();

    // Full 9-digit national number -> button enabled.
    fireEvent.change(phoneField, { target: { value: "+971501234567" } });
    expect(sendBtn).not.toBeDisabled();
  });

  test("page mode renders a single centered card (no nested .auth-card wrapper)", () => {
    global.fetch = jest.fn();
    const { container } = render(
      <OTPVerification mode="page" purpose="profile_verify" autoStart={false} />
    );
    // The old double-wrap (auth-card > OTP card) caused the ultrawide off-centre look.
    expect(container.querySelector(".check-email-card")).toBeNull();
    expect(container.querySelector(".auth-card")).toBeNull();
    // The OTP card itself is present, inside the centered auth shell.
    expect(container.querySelector(".auth-container .phone-verification-flow")).not.toBeNull();
  });
});
