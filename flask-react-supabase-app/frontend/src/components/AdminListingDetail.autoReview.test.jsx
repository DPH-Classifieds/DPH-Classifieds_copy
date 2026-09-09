import {
  getAutoReviewStatusKey,
  getAutoReviewViewModel,
} from './AdminListingDetail';

describe('AdminListingDetail auto-review explanations', () => {
  test('explains an unprocessed auto-review queue item and keeps the rerun action available', () => {
    const model = getAutoReviewViewModel({ status: 'pending_auto_review' });

    expect(model.statusKey).toBe('awaiting');
    expect(model.title).toBe('Awaiting auto-review');
    expect(model.summary).toMatch(/no automated decision has been recorded/i);
    expect(model.nextAction).toMatch(/do not treat the queue state as approval/i);
    expect(model.canRun).toBe(true);
  });

  test('shows field-level submitted versus decoded values for a VIN mismatch', () => {
    const listing = {
      status: 'pending',
      auto_review_state: 'auto_queued',
      auto_review_reasons: ['vin_decoded_mismatch'],
      make: 'Honda',
      model: 'Accord',
      make_year: 2020,
    };
    const verificationScan = {
      vin_validation: {
        decoded: { make: 'Toyota', model: 'Accord', model_year: 2018 },
      },
    };

    const model = getAutoReviewViewModel(listing, verificationScan);

    expect(model.title).toBe('Needs manual review');
    expect(model.reasons).toEqual(['vin_decoded_mismatch']);
    expect(model.mismatchFields).toEqual([
      { key: 'make', label: 'Make', submitted: 'Honda', decoded: 'Toyota' },
      { key: 'year', label: 'Year', submitted: '2020', decoded: '2018' },
    ]);
    expect(model.nextAction).toMatch(/approve or reject/i);
  });

  test('keeps the mismatch explanation honest when decoded field values are unavailable', () => {
    const model = getAutoReviewViewModel({
      status: 'pending',
      auto_review_state: 'auto_queued',
      auto_review_reasons: ['vin_decoded_mismatch'],
      make: 'Honda',
      model: 'Accord',
      make_year: 2020,
    });

    expect(model.mismatchFields).toEqual([]);
    expect(model.reasons.map((reason) => reason)).toContain('vin_decoded_mismatch');
  });

  test('distinguishes automated approval and rejection from manual decisions', () => {
    const approved = getAutoReviewViewModel({ status: 'approved', auto_review_state: 'auto_approved' });
    const autoRejected = getAutoReviewViewModel({ status: 'rejected', auto_review_state: 'auto_rejected' });
    const manualPending = getAutoReviewViewModel({ status: 'pending' });
    const manualRejected = getAutoReviewViewModel({ status: 'rejected' });

    expect(approved.title).toBe('Auto-approved');
    expect(approved.summary).toMatch(/not a manual reviewer decision/i);
    expect(approved.canRun).toBe(false);
    expect(autoRejected.title).toBe('Auto-rejected');
    expect(autoRejected.summary).toMatch(/distinct from a rejection made by an admin/i);
    expect(manualPending.title).toBe('Manual review pending');
    expect(manualPending.summary).toMatch(/No auto-review decision is recorded/i);
    expect(manualRejected.title).toBe('Rejected manually');
    expect(manualRejected.summary).toMatch(/not by the auto-review worker/i);
  });

  test('prioritizes the recorded auto state over the displayed moderation status', () => {
    expect(getAutoReviewStatusKey({ status: 'pending', auto_review_state: 'auto_approved' })).toBe('auto_approved');
    expect(getAutoReviewStatusKey({ status: 'rejected', auto_review_state: 'auto_queued' })).toBe('needs_review');
  });
});
