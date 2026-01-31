-- =============================================
-- Fix PGRST203: Remove 2-param create_debate_room overload
-- PostgREST can't choose between the 2-param (002) and 3-param (003) versions.
-- Drop the 2-param version so only the 3-param version remains.
-- Run after 003_debate_title_and_browse.sql
-- =============================================

DROP FUNCTION IF EXISTS create_debate_room(int, text);
