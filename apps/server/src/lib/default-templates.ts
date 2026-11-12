export interface DefaultTemplate {
  key: string;
  name: string;
  description: string;
  titleTemplate: string;
  contentTemplate: string;
}

/**
 * First-run templates. They are written into the user's own template list so
 * they can be edited, deleted or used as a reference like any other template.
 */
export function defaultTemplates(locale: 'zh' | 'en'): DefaultTemplate[] {
  if (locale === 'en') {
    return [
      {
        key: 'meeting',
        name: 'Meeting notes',
        description: 'Agenda, discussion, decisions and action items',
        titleTemplate: 'Meeting notes · {{date}}',
        contentTemplate: `## Attendees

## Goal

## Agenda

1. 

## Discussion

- 

## Decisions

- 

## Action items

- [ ] Next step
`,
      },
      {
        key: 'daily',
        name: 'Daily note',
        description: 'What happened today, thoughts and tomorrow',
        titleTemplate: 'Daily note · {{date}}',
        contentTemplate: `## What happened

## Thoughts

## Tomorrow

- [ ] First thing tomorrow
`,
      },
      {
        key: 'project',
        name: 'Project brief',
        description: 'Goal, scope, milestones and risks',
        titleTemplate: 'Project brief',
        contentTemplate: `**One-line goal:**

**Why now:**

## Scope

- In:
- Out:

## Milestones

| Date | Deliverable | Owner |
| --- | --- | --- |
|  |  |  |

## Risks

- 
`,
      },
    ];
  }
  return [
    {
      key: 'meeting',
      name: '会议记录',
      description: '议程、讨论、决定与行动项',
      titleTemplate: '会议记录 · {{date}}',
      contentTemplate: `## 参与人

## 目标

## 议程

1. 

## 讨论

- 

## 决定

- 

## 行动项

- [ ] 下一步
`,
    },
    {
      key: 'daily',
      name: '日报',
      description: '今天发生了什么、想法与明天',
      titleTemplate: '日报 · {{date}}',
      contentTemplate: `## 今天发生了什么

## 想法

## 明天

- [ ] 明天第一件事
`,
    },
    {
      key: 'project',
      name: '项目简报',
      description: '目标、范围、里程碑与风险',
      titleTemplate: '项目简报',
      contentTemplate: `**一句话目标：**

**为什么现在做：**

## 范围

- 包含：
- 不包含：

## 里程碑

| 日期 | 交付物 | 负责人 |
| --- | --- | --- |
|  |  |  |

## 风险

- 
`,
    },
  ];
}
