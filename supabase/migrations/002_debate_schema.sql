-- =============================================
-- Middle Debate Supabase Schema
-- Run after 001_initial_schema.sql
-- =============================================

-- 1) DEBATE_ROOMS
CREATE TABLE IF NOT EXISTS debate_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  status text CHECK (status IN ('waiting', 'live', 'qna', 'ended')) DEFAULT 'waiting',
  num_segments int NOT NULL DEFAULT 6,
  current_segment int DEFAULT 0,
  segment_start_at timestamptz,
  segment_duration_sec int DEFAULT 120,
  qna_duration_sec int DEFAULT 600,
  rules_text text
);

-- 2) DEBATE_PARTICIPANTS (speaker_a, speaker_b, viewer)
CREATE TABLE IF NOT EXISTS debate_participants (
  room_id uuid REFERENCES debate_rooms(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  role text CHECK (role IN ('speaker_a', 'speaker_b', 'viewer')) NOT NULL,
  joined_at timestamptz DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

-- 3) DEBATE_CHAT (viewer chat)
CREATE TABLE IF NOT EXISTS debate_chat (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid REFERENCES debate_rooms(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name text,
  text text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 4) DEBATE_QUESTIONS (viewer Q&A)
CREATE TABLE IF NOT EXISTS debate_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid REFERENCES debate_rooms(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name text,
  text text NOT NULL,
  created_at timestamptz DEFAULT now(),
  selected_at timestamptz,
  answered_at timestamptz
);

-- 5) DEBATE_FACT_CHECKS
CREATE TABLE IF NOT EXISTS debate_fact_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid REFERENCES debate_rooms(id) ON DELETE CASCADE,
  claim_text text NOT NULL,
  source_display_name text,
  source_role text,
  verdict text CHECK (verdict IN ('true', 'false', 'unverified', 'pending')),
  summary text,
  sources_json jsonb,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_debate_rooms_status ON debate_rooms(status);
CREATE INDEX IF NOT EXISTS idx_debate_participants_room ON debate_participants(room_id);
CREATE INDEX IF NOT EXISTS idx_debate_chat_room ON debate_chat(room_id);
CREATE INDEX IF NOT EXISTS idx_debate_questions_room ON debate_questions(room_id);
CREATE INDEX IF NOT EXISTS idx_debate_fact_checks_room ON debate_fact_checks(room_id);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE debate_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE debate_chat;
ALTER PUBLICATION supabase_realtime ADD TABLE debate_questions;
ALTER PUBLICATION supabase_realtime ADD TABLE debate_fact_checks;
ALTER PUBLICATION supabase_realtime ADD TABLE debate_participants;

-- =============================================
-- RLS
-- =============================================
ALTER TABLE debate_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE debate_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE debate_chat ENABLE ROW LEVEL SECURITY;
ALTER TABLE debate_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE debate_fact_checks ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can view debate rooms (for join)
CREATE POLICY "Authenticated can view debate rooms"
  ON debate_rooms FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can create debate rooms"
  ON debate_rooms FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Participants can update debate room"
  ON debate_rooms FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM debate_participants
      WHERE debate_participants.room_id = debate_rooms.id
      AND debate_participants.user_id = auth.uid()
      AND debate_participants.role IN ('speaker_a', 'speaker_b')
    )
  );

-- Participants
CREATE POLICY "Users can join debate as participant"
  ON debate_participants FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authenticated can view debate participants"
  ON debate_participants FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Chat: insert if participant; select if participant
CREATE POLICY "Participants can send debate chat"
  ON debate_chat FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM debate_participants
      WHERE debate_participants.room_id = debate_chat.room_id
      AND debate_participants.user_id = auth.uid()
    )
  );

CREATE POLICY "Participants can view debate chat"
  ON debate_chat FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM debate_participants
      WHERE debate_participants.room_id = debate_chat.room_id
      AND debate_participants.user_id = auth.uid()
    )
  );

-- Questions: same
CREATE POLICY "Participants can submit debate questions"
  ON debate_questions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM debate_participants
      WHERE debate_participants.room_id = debate_questions.room_id
      AND debate_participants.user_id = auth.uid()
    )
  );

CREATE POLICY "Participants can view debate questions"
  ON debate_questions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM debate_participants
      WHERE debate_participants.room_id = debate_questions.room_id
      AND debate_participants.user_id = auth.uid()
    )
  );

CREATE POLICY "Speakers can update debate questions (select/answer)"
  ON debate_questions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM debate_participants
      WHERE debate_participants.room_id = debate_questions.room_id
      AND debate_participants.user_id = auth.uid()
      AND debate_participants.role IN ('speaker_a', 'speaker_b')
    )
  );

-- Fact checks: insert from backend/speakers; select for participants
CREATE POLICY "Participants can view fact checks"
  ON debate_fact_checks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM debate_participants
      WHERE debate_participants.room_id = debate_fact_checks.room_id
      AND debate_participants.user_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated can insert fact checks"
  ON debate_fact_checks FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- =============================================
-- RPC: create_debate_room
-- =============================================
CREATE OR REPLACE FUNCTION create_debate_room(
  p_num_segments int,
  p_display_name text
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

  INSERT INTO debate_rooms (num_segments, status, rules_text)
  VALUES (p_num_segments, 'waiting', 'Each speaker gets 2 minutes per segment. No interruptions. After segments, 10-min Q&A with randomly selected viewer questions.')
  RETURNING id INTO v_room_id;

  INSERT INTO debate_participants (room_id, user_id, display_name, role)
  VALUES (v_room_id, v_user_id, p_display_name, 'speaker_a');

  room_id := v_room_id;
  role := 'speaker_a';
  RETURN NEXT;
END;
$$;

-- =============================================
-- RPC: join_debate_room
-- =============================================
CREATE OR REPLACE FUNCTION join_debate_room(
  p_room_id uuid,
  p_display_name text,
  p_as_viewer boolean DEFAULT false
)
RETURNS TABLE (role text, status text, num_segments int)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_current_status text;
  v_speaker_b_count int;
  v_num_segments int;
  v_new_role text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  SELECT r.status, r.num_segments
  INTO v_current_status, v_num_segments
  FROM debate_rooms r
  WHERE r.id = p_room_id
  FOR UPDATE;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Room not found';
  END IF;

  IF p_as_viewer THEN
    v_new_role := 'viewer';
    INSERT INTO debate_participants (room_id, user_id, display_name, role)
    VALUES (p_room_id, v_user_id, p_display_name, 'viewer')
    ON CONFLICT (room_id, user_id) DO UPDATE SET display_name = p_display_name;
    role := v_new_role;
    status := v_current_status;
    num_segments := v_num_segments;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Joining as debater: only if waiting and speaker_b slot free
  IF v_current_status != 'waiting' THEN
    RAISE EXCEPTION 'Room is not waiting for a second debater';
  END IF;

  SELECT COUNT(*) INTO v_speaker_b_count
  FROM debate_participants
  WHERE room_id = p_room_id AND debate_participants.role = 'speaker_b';

  IF v_speaker_b_count > 0 THEN
    RAISE EXCEPTION 'Speaker B slot already taken';
  END IF;

  INSERT INTO debate_participants (room_id, user_id, display_name, role)
  VALUES (p_room_id, v_user_id, p_display_name, 'speaker_b')
  ON CONFLICT (room_id, user_id) DO UPDATE SET display_name = p_display_name, role = 'speaker_b';

  UPDATE debate_rooms
  SET status = 'live', current_segment = 0, segment_start_at = now()
  WHERE id = p_room_id;

  role := 'speaker_b';
  status := 'live';
  num_segments := v_num_segments;
  RETURN NEXT;
END;
$$;

-- =============================================
-- RPC: advance_debate_segment
-- =============================================
CREATE OR REPLACE FUNCTION advance_debate_segment(
  p_room_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_room debate_rooms%ROWTYPE;
BEGIN
  SELECT * INTO v_room FROM debate_rooms WHERE id = p_room_id FOR UPDATE;
  IF v_room.id IS NULL THEN
    RAISE EXCEPTION 'Room not found';
  END IF;
  IF v_room.status NOT IN ('live', 'qna') THEN
    RAISE EXCEPTION 'Room not in live or qna phase';
  END IF;

  IF v_room.status = 'live' THEN
    IF v_room.current_segment + 1 >= v_room.num_segments THEN
      -- Move to Q&A
      UPDATE debate_rooms
      SET status = 'qna', current_segment = 0, segment_start_at = now()
      WHERE id = p_room_id;
    ELSE
      UPDATE debate_rooms
      SET current_segment = current_segment + 1, segment_start_at = now()
      WHERE id = p_room_id;
    END IF;
  ELSIF v_room.status = 'qna' THEN
    -- Q&A segment advance just resets timer or ends
    UPDATE debate_rooms
    SET segment_start_at = now()
    WHERE id = p_room_id;
  END IF;
END;
$$;

-- =============================================
-- RPC: select_next_question (random unselected question)
-- =============================================
CREATE OR REPLACE FUNCTION select_next_debate_question(
  p_room_id uuid
)
RETURNS TABLE (question_id uuid, question_text text, display_name text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_q debate_questions%ROWTYPE;
BEGIN
  SELECT * INTO v_q
  FROM debate_questions
  WHERE room_id = p_room_id AND selected_at IS NULL
  ORDER BY random()
  LIMIT 1
  FOR UPDATE;

  IF v_q.id IS NOT NULL THEN
    UPDATE debate_questions SET selected_at = now() WHERE id = v_q.id;
    question_id := v_q.id;
    question_text := v_q.text;
    display_name := v_q.display_name;
    RETURN NEXT;
  END IF;
END;
$$;

-- =============================================
-- RPC: mark_question_answered
-- =============================================
CREATE OR REPLACE FUNCTION mark_debate_question_answered(
  p_question_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE debate_questions SET answered_at = now() WHERE id = p_question_id;
END;
$$;

-- =============================================
-- RPC: leave_debate_room
-- =============================================
CREATE OR REPLACE FUNCTION leave_debate_room(
  p_room_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_participant_count int;
BEGIN
  DELETE FROM debate_participants
  WHERE room_id = p_room_id AND user_id = v_user_id;

  SELECT COUNT(*) INTO v_participant_count
  FROM debate_participants WHERE room_id = p_room_id;

  IF v_participant_count = 0 THEN
    UPDATE debate_rooms SET status = 'ended' WHERE id = p_room_id;
  END IF;
END;
$$;
