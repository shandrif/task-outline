-- Store visit reports are now scored out of 100% instead of 1-5 points: convert the scores already saved (x 20).
-- (Employee scores in the team table were free text and are left as they are.)
UPDATE sv_reports SET
  overall_score = overall_score * 20,
  quality_avg = quality_avg * 20,
  body = CASE WHEN json_type(body, '$.quality') = 'array'
    THEN json_set(body, '$.quality', (SELECT json_group_array(json(CASE WHEN json_extract(value, '$.score') IS NULL THEN value ELSE json_set(value, '$.score', json_extract(value, '$.score') * 20) END)) FROM json_each(body, '$.quality')))
    ELSE body END;
