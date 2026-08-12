import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import PhoneGate from "./PhoneGate";

// Drive the guard directly by swapping what useAuth returns per test.
let mockAuthState;
jest.mock("../context/AuthContext", () => ({ useAuth: () => mockAuthState }));

// Minimal app: PhoneGate wraps the routes, exactly like App.js does.
const App = () => (
  <PhoneGate>
    <Routes>
      <Route path="/" element={<div>HOME</div>} />
      <Route path="/cars/123" element={<div>CAR DETAIL</div>} />
      <Route path="/verify-phone" element={<div>VERIFY SCREEN</div>} />
      <Route path="/auth/callback" element={<div>OAUTH CALLBACK</div>} />
    </Routes>
  </PhoneGate>
);

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );

describe("PhoneGate", () => {
  test("unverified user is bounced off a normal route to the verify screen", () => {
    mockAuthState = { user: { id: "u1", phone_verified: false }, isLoading: false };
    renderAt("/cars/123");
    expect(screen.getByText("VERIFY SCREEN")).toBeInTheDocument();
    expect(screen.queryByText("CAR DETAIL")).not.toBeInTheDocument();
  });

  test("unverified user can still reach /verify-phone (no redirect loop)", () => {
    mockAuthState = { user: { id: "u1", phone_verified: false }, isLoading: false };
    renderAt("/verify-phone");
    expect(screen.getByText("VERIFY SCREEN")).toBeInTheDocument();
  });

  test("unverified user can reach the allowlisted OAuth callback", () => {
    mockAuthState = { user: { id: "u1", phone_verified: false }, isLoading: false };
    renderAt("/auth/callback");
    expect(screen.getByText("OAUTH CALLBACK")).toBeInTheDocument();
  });

  test("verified user passes through untouched", () => {
    mockAuthState = { user: { id: "u1", phone_verified: true }, isLoading: false };
    renderAt("/cars/123");
    expect(screen.getByText("CAR DETAIL")).toBeInTheDocument();
  });

  test("logged-out visitor is NOT gated (public browsing stays open)", () => {
    mockAuthState = { user: null, isLoading: false };
    renderAt("/cars/123");
    expect(screen.getByText("CAR DETAIL")).toBeInTheDocument();
  });

  test("while auth is loading, nothing is gated yet", () => {
    mockAuthState = { user: null, isLoading: true };
    renderAt("/cars/123");
    expect(screen.getByText("CAR DETAIL")).toBeInTheDocument();
  });
});
