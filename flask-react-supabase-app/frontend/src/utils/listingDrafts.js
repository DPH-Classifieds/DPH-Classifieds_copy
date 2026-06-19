import apiClient from './apiClient';

export const readDraftPayload = (draft) => {
  if (!draft) return null;
  return draft.payload || draft.draft_payload || null;
};

export const loadListingDraft = async (draftKey, storageKey) => {
  try {
    const response = await apiClient.request(`/api/user/drafts/${draftKey}`);
    const remotePayload = readDraftPayload(response?.draft);
    if (remotePayload) {
      return remotePayload;
    }
  } catch (error) {
    // Browser fallback keeps draft save useful during short API outages.
  }

  try {
    const localDraft = localStorage.getItem(storageKey);
    return localDraft ? JSON.parse(localDraft) : null;
  } catch (error) {
    return null;
  }
};

export const saveListingDraft = async (draftKey, storageKey, draftPayload) => {
  localStorage.setItem(storageKey, JSON.stringify(draftPayload));
  return apiClient.request(`/api/user/drafts/${draftKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      draft_key: draftKey,
      payload: draftPayload,
    },
  });
};

export const clearListingDraft = async (draftKey, storageKey) => {
  localStorage.removeItem(storageKey);
  try {
    await apiClient.request(`/api/user/drafts/${draftKey}`, { method: 'DELETE' });
  } catch (error) {
    // Clearing the local draft is enough for the UI; remote cleanup can retry later.
  }
};
