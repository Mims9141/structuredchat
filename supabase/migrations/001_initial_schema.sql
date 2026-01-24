-- =============================================
-- OneTwoOne Supabase Schema Migration
-- Run this in Supabase SQL Editor
-- =============================================

-- 1) ROOMS TABLE
CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  status text CHECK (status IN ('waiting', 'matched', 'closed')) DEFAULT 'waiting',
  mode text CHECK (mode IN ('video', 'audio', 'text', 'any')) NOT NULL,
  segment_start_at timestamptz,
  current_segment int DEFAULT 0,
  segment_duration_sec int DEFAULT 60
);

-- 2) ROOM_MEMBERS TABLE
CREATE TABLE IF NOT EXISTS room_members (
  room_id uuid REFERENCES rooms(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  role text CHECK (role IN ('user1', 'user2')) NOT NULL,
  joined_at timestamptz DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

-- 3) MESSAGES TABLE
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid REFERENCES rooms(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name text,
  text text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 4) REPORTS TABLE
CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  reasons text[] NOT NULL,
  details text NOT NULL
);

-- =============================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================

-- Enable RLS on all tables
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- ROOMS POLICIES
-- Users can select rooms they are a member of
CREATE POLICY "Users can view rooms they belong to"
  ON rooms FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM room_members
      WHERE room_members.room_id = rooms.id
      AND room_members.user_id = auth.uid()
    )
    OR status = 'waiting' -- Allow viewing waiting rooms for matchmaking
  );

-- Authenticated users can create rooms
CREATE POLICY "Authenticated users can create rooms"
  ON rooms FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Users can update rooms they are a member of
CREATE POLICY "Members can update their rooms"
  ON rooms FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM room_members
      WHERE room_members.room_id = rooms.id
      AND room_members.user_id = auth.uid()
    )
  );

-- ROOM_MEMBERS POLICIES
-- Users can insert their own membership
CREATE POLICY "Users can join rooms"
  ON room_members FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can view members of rooms they belong to
CREATE POLICY "Users can view room members"
  ON room_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM room_members rm
      WHERE rm.room_id = room_members.room_id
      AND rm.user_id = auth.uid()
    )
    OR room_id IN (SELECT id FROM rooms WHERE status = 'waiting') -- For matchmaking
  );

-- MESSAGES POLICIES
-- Users can insert messages to rooms they belong to
CREATE POLICY "Members can send messages"
  ON messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM room_members
      WHERE room_members.room_id = messages.room_id
      AND room_members.user_id = auth.uid()
    )
  );

-- Users can view messages from rooms they belong to
CREATE POLICY "Members can view messages"
  ON messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM room_members
      WHERE room_members.room_id = messages.room_id
      AND room_members.user_id = auth.uid()
    )
  );

-- REPORTS POLICIES
-- Authenticated users can create reports
CREATE POLICY "Authenticated users can create reports"
  ON reports FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Only admins can view reports (placeholder - customize as needed)
CREATE POLICY "Admins can view reports"
  ON reports FOR SELECT
  USING (
    -- Placeholder: Replace with actual admin check
    -- e.g., auth.uid() IN (SELECT user_id FROM admins)
    -- For now, allow authenticated users to view (change in production)
    auth.uid() IS NOT NULL
  );

-- =============================================
-- MATCHMAKING RPC FUNCTION
-- =============================================

CREATE OR REPLACE FUNCTION match_or_create_room(
  p_mode text,
  p_display_name text
)
RETURNS TABLE (room_id uuid, role text, matched boolean, peer_name text, chat_mode text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_existing_room_id uuid;
  v_new_room_id uuid;
  v_peer_name text;
  v_actual_mode text;
BEGIN
  -- Input validation
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  -- Look for a waiting room that:
  -- 1. Has compatible mode (same mode, or either is 'any')
  -- 2. Has exactly 1 member
  -- 3. Was not created by the current user
  SELECT r.id, rm.display_name, r.mode
  INTO v_existing_room_id, v_peer_name, v_actual_mode
  FROM rooms r
  JOIN room_members rm ON rm.room_id = r.id
  WHERE r.status = 'waiting'
    AND (
      r.mode = p_mode
      OR r.mode = 'any'
      OR p_mode = 'any'
    )
    AND rm.user_id != v_user_id
    AND (
      SELECT COUNT(*) FROM room_members WHERE room_members.room_id = r.id
    ) = 1
  ORDER BY r.created_at ASC
  LIMIT 1
  FOR UPDATE OF r;

  IF v_existing_room_id IS NOT NULL THEN
    -- Determine actual chat mode
    IF v_actual_mode = 'any' AND p_mode != 'any' THEN
      v_actual_mode := p_mode;
    ELSIF p_mode = 'any' AND v_actual_mode != 'any' THEN
      -- Keep v_actual_mode as is
      NULL;
    ELSIF p_mode = 'any' AND v_actual_mode = 'any' THEN
      v_actual_mode := 'video'; -- Default to video when both are 'any'
    END IF;

    -- Join the existing room as user2
    INSERT INTO room_members (room_id, user_id, display_name, role)
    VALUES (v_existing_room_id, v_user_id, p_display_name, 'user2');

    -- Update room status to matched
    UPDATE rooms
    SET status = 'matched',
        segment_start_at = now(),
        current_segment = 0,
        mode = v_actual_mode
    WHERE id = v_existing_room_id;

    RETURN QUERY SELECT v_existing_room_id, 'user2'::text, true, v_peer_name, v_actual_mode;
  ELSE
    -- No match found, create a new room
    INSERT INTO rooms (mode, status)
    VALUES (p_mode, 'waiting')
    RETURNING id INTO v_new_room_id;

    -- Join as user1
    INSERT INTO room_members (room_id, user_id, display_name, role)
    VALUES (v_new_room_id, v_user_id, p_display_name, 'user1');

    RETURN QUERY SELECT v_new_room_id, 'user1'::text, false, NULL::text, p_mode;
  END IF;
END;
$$;

-- =============================================
-- LEAVE ROOM FUNCTION
-- =============================================

CREATE OR REPLACE FUNCTION leave_room(p_room_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  -- Remove user from room
  DELETE FROM room_members
  WHERE room_id = p_room_id AND user_id = v_user_id;

  -- If room is now empty or has 1 member, close it
  UPDATE rooms
  SET status = 'closed'
  WHERE id = p_room_id
    AND (
      SELECT COUNT(*) FROM room_members WHERE room_members.room_id = p_room_id
    ) < 2;
END;
$$;

-- =============================================
-- ADVANCE SEGMENT FUNCTION
-- =============================================

CREATE OR REPLACE FUNCTION advance_segment(p_room_id uuid)
RETURNS TABLE (new_segment int, new_start_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_current_segment int;
BEGIN
  -- Check user is user1 (only user1 can advance)
  SELECT role INTO v_role
  FROM room_members
  WHERE room_id = p_room_id AND user_id = v_user_id;

  IF v_role != 'user1' THEN
    RAISE EXCEPTION 'Only user1 can advance segments';
  END IF;

  -- Advance the segment
  UPDATE rooms
  SET current_segment = current_segment + 1,
      segment_start_at = now()
  WHERE id = p_room_id
  RETURNING current_segment, segment_start_at
  INTO v_current_segment, new_start_at;

  new_segment := v_current_segment;
  RETURN NEXT;
END;
$$;

-- =============================================
-- INDEXES FOR PERFORMANCE
-- =============================================

CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_rooms_mode ON rooms(mode);
CREATE INDEX IF NOT EXISTS idx_room_members_user_id ON room_members(user_id);
CREATE INDEX IF NOT EXISTS idx_room_members_room_id ON room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

-- =============================================
-- ENABLE REALTIME
-- =============================================

-- Enable realtime for the tables we need to subscribe to
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE room_members;
