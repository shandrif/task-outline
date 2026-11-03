-- Barista verification: the drink sections are picked per evaluation ("picker" sections). Only the drinks the trainer
-- selects are shown and scored; the other drinks are excluded automatically (they sit in the evaluation's skip list).
ALTER TABLE sections ADD COLUMN picker INTEGER NOT NULL DEFAULT 0;
UPDATE sections SET picker=1 WHERE sort>=100 AND position_id=(SELECT id FROM positions WHERE name='Barista verification');

-- Drafts already in progress: exclude every drink that has no answers yet (drinks with answers stay selected).
UPDATE evaluations SET skips_json = (
    SELECT COALESCE(json_group_array(s.id), '[]') FROM sections s
    WHERE s.picker=1 AND s.active=1 AND s.position_id=evaluations.position_id
      AND NOT EXISTS (SELECT 1 FROM items i WHERE i.section_id=s.id AND json_extract(evaluations.answers_json, '$."' || i.id || '"') IS NOT NULL))
WHERE status='draft' AND skips_json='[]' AND position_id IN (SELECT position_id FROM sections WHERE picker=1);
