-- Buying Requests (anonymous posters)
-- - Public can read only approved + active + non-expired + non-archived
-- - Owners can CRUD their own rows
-- - Images visibility is tied to parent visibility (or owner)

CREATE TABLE IF NOT EXISTS public.buying_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  user_email VARCHAR(255),
  contact_email VARCHAR(255),

  item_type TEXT NOT NULL CHECK (item_type IN ('car', 'plate', 'part', 'bike')),
  item_name TEXT NOT NULL,
  listing_title TEXT,

  mileage_preference TEXT NOT NULL,
  regional_spec TEXT NOT NULL,
  reference_notes TEXT,
  budget NUMERIC(12, 2),

  car_manufacturer TEXT,
  car_model TEXT,
  trim TEXT,

  whatsapp_country_code TEXT,
  whatsapp_number TEXT,
  whatsapp_prefill_text TEXT,

  -- Moderation + lifecycle
  is_approved BOOLEAN DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'active', 'rejected', 'deleted')),
  rejection_note TEXT,

  expires_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  retention_expires_at TIMESTAMPTZ,
  last_extended_at TIMESTAMPTZ,
  extension_count INT NOT NULL DEFAULT 0,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  auto_removed_at TIMESTAMPTZ,
  sold_status TEXT,
  sold_status_set_at TIMESTAMPTZ,
  sold_response_deadline TIMESTAMPTZ,

  expiry_reminder_sent_at TIMESTAMPTZ,
  expired_email_sent_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.buying_request_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buying_request_id UUID NOT NULL REFERENCES public.buying_requests(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  url TEXT,
  display_url TEXT,
  focal_x NUMERIC(5,2) DEFAULT 50,
  focal_y NUMERIC(5,2) DEFAULT 50,
  crop_meta JSONB,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_buying_requests_user_id ON public.buying_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_buying_requests_status ON public.buying_requests(status);
CREATE INDEX IF NOT EXISTS idx_buying_requests_is_approved ON public.buying_requests(is_approved);
CREATE INDEX IF NOT EXISTS idx_buying_requests_item_type ON public.buying_requests(item_type);
CREATE INDEX IF NOT EXISTS idx_buying_requests_make_model_trim ON public.buying_requests(car_manufacturer, car_model, trim);
CREATE INDEX IF NOT EXISTS idx_buying_requests_lifecycle ON public.buying_requests(status, is_archived, expires_at, retention_expires_at);

CREATE INDEX IF NOT EXISTS idx_buying_request_images_buying_request_id ON public.buying_request_images(buying_request_id);

-- RLS
ALTER TABLE public.buying_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buying_request_images ENABLE ROW LEVEL SECURITY;

-- Public read policy: only approved + active + non-expired + non-archived
DROP POLICY IF EXISTS "read_public_buying_requests" ON public.buying_requests;
CREATE POLICY "read_public_buying_requests"
  ON public.buying_requests
  FOR SELECT
  USING (
    status IN ('approved', 'active')
    AND is_archived = FALSE
    AND expired_at IS NULL
    AND (expires_at IS NULL OR NOW() < expires_at)
  );

-- Owner CRUD (poster remains anonymous to others; access is by auth.uid())
DROP POLICY IF EXISTS "owner_select_buying_requests" ON public.buying_requests;
CREATE POLICY "owner_select_buying_requests"
  ON public.buying_requests
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "owner_insert_buying_requests" ON public.buying_requests;
CREATE POLICY "owner_insert_buying_requests"
  ON public.buying_requests
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "owner_update_buying_requests" ON public.buying_requests;
CREATE POLICY "owner_update_buying_requests"
  ON public.buying_requests
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "owner_delete_buying_requests" ON public.buying_requests;
CREATE POLICY "owner_delete_buying_requests"
  ON public.buying_requests
  FOR DELETE
  USING (auth.uid() = user_id);

-- Images: readable only when parent is publicly visible, or owner can read/manage
DROP POLICY IF EXISTS "read_public_buying_request_images" ON public.buying_request_images;
CREATE POLICY "read_public_buying_request_images"
  ON public.buying_request_images
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.buying_requests br
      WHERE br.id = buying_request_images.buying_request_id
        AND br.status IN ('approved', 'active')
        AND br.is_archived = FALSE
        AND br.expired_at IS NULL
        AND (br.expires_at IS NULL OR NOW() < br.expires_at)
    )
  );

DROP POLICY IF EXISTS "owner_select_buying_request_images" ON public.buying_request_images;
CREATE POLICY "owner_select_buying_request_images"
  ON public.buying_request_images
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.buying_requests br
      WHERE br.id = buying_request_images.buying_request_id
        AND br.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "owner_insert_buying_request_images" ON public.buying_request_images;
CREATE POLICY "owner_insert_buying_request_images"
  ON public.buying_request_images
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.buying_requests br
      WHERE br.id = buying_request_images.buying_request_id
        AND br.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "owner_update_buying_request_images" ON public.buying_request_images;
CREATE POLICY "owner_update_buying_request_images"
  ON public.buying_request_images
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.buying_requests br
      WHERE br.id = buying_request_images.buying_request_id
        AND br.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.buying_requests br
      WHERE br.id = buying_request_images.buying_request_id
        AND br.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "owner_delete_buying_request_images" ON public.buying_request_images;
CREATE POLICY "owner_delete_buying_request_images"
  ON public.buying_request_images
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.buying_requests br
      WHERE br.id = buying_request_images.buying_request_id
        AND br.user_id = auth.uid()
    )
  );
