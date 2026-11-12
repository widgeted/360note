-- Marked only recognises GFM task items when the checkbox has text after it.
-- The first version of the seeded templates used a blank "- [ ]"; add a
-- placeholder so existing default templates still render as checkboxes.
UPDATE templates
SET content_template = replace(content_template, E'- [ ] \n', E'- [ ] 下一步\n')
WHERE builtin_key = 'meeting' AND content_template LIKE E'%## 行动项%';

UPDATE templates
SET content_template = replace(content_template, E'- [ ] \n', E'- [ ] 明天第一件事\n')
WHERE builtin_key = 'daily' AND content_template LIKE E'%## 明天%';

UPDATE templates
SET content_template = replace(content_template, E'- [ ] \n', E'- [ ] Next step\n')
WHERE builtin_key = 'meeting' AND content_template LIKE '%## Action items%';

UPDATE templates
SET content_template = replace(content_template, E'- [ ] \n', E'- [ ] First thing tomorrow\n')
WHERE builtin_key = 'daily' AND content_template LIKE '%## Tomorrow%';
