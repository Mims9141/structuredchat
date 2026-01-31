-- =============================================
-- Add title to debate_rooms for search/browse
-- Run after 002_debate_schema.sql
-- =============================================

ALTER TABLE debate_rooms
  ADD COLUMN IF NOT EXISTS title text DEFAULT 'Untitled Debate';

CREATE INDEX IF NOT EXISTS idx_debate_rooms_created_at ON debate_rooms (created_at DESC);

-- Update create_debate_room to accept optional title
CREATE OR REPLACE FUNCTION create_debate_room(
  p_num_segments int,
  p_display_name text,
  p_title text DEFAULT 'Untitled Debate'
)
RETURNS TABLE (room_id uuid, role text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_room_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;
  IF p_num_segments < 1 OR p_num_segments > 20 THEN
    RAISE EXCEPTION 'num_segments must be between 1 and 20';
  END IF;

  INSERT INTO debate_rooms (num_segments, status, rules_text, title)
  VALUES (
    p_num_segments,
    'waiting',
    'Each speaker gets 2 minutes per segment. No interruptions. After segments, 10-min Q&A with randomly selected viewer questions.',
    COALESCE(NULLIF(TRIM(p_title), ''), 'Untitled Debate')
  )
  RETURNING id INTO v_room_id;

  INSERT INTO debate_participants (room_id, user_id, display_name, role)
  VALUES (v_room_id, v_user_id, p_display_name, 'speaker_a');

  room_id := v_room_id;
  role := 'speaker_a';
  RETURN NEXT;
END;
$$;
