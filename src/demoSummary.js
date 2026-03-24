export const demoSummary = {
  title: "Q3 Roadmap & Dashboard Redesign Review",
  tldr: "The team decided to prioritize bulk export over API rate limiting for Q3 based on $180k ARR at risk from enterprise accounts. Marcus will prototype a top-positioned filter panel by Thursday, and Jordan will prepare a bulk export requirements one-pager by July 14th. The CSV vs. PDF export format question remains open pending a customer survey.",
  topics: [
    {
      title: "Dashboard Redesign Feedback",
      summary: "User research and support tickets (47 in June) confirm that the filter panel is too buried. The team agreed to move it to the top of the dashboard."
    },
    {
      title: "Q3 Roadmap Prioritization",
      summary: "Engineering can only deliver one major feature this quarter. Bulk export was chosen over API rate limiting due to enterprise demand and revenue risk."
    },
    {
      title: "New Onboarding Flow Launch",
      summary: "The redesigned onboarding flow goes live Monday. The team will closely monitor drop-off metrics throughout the following week."
    }
  ],
  decisions: [
    {
      decision: "Move filter panel to top of dashboard",
      context: "3 customers mentioned it in interviews and 47 support tickets in June confirmed the issue"
    },
    {
      decision: "Prioritize bulk export for Q3 over API rate limiting",
      context: "8 enterprise accounts requested it; 2 accounts ($180k ARR) at risk of churning without it"
    },
    {
      decision: "Table the CSV vs. PDF export format decision",
      context: "Need more data from the 8 requesting accounts before committing to scope"
    }
  ],
  actionItems: [
    {
      task: "Create filter panel prototype/mockup",
      owner: "Marcus",
      due: "Thursday EOD"
    },
    {
      task: "Write bulk export requirements one-pager",
      owner: "Jordan",
      due: "Friday, July 14th"
    },
    {
      task: "Send CSV vs. PDF preference survey to 8 enterprise accounts",
      owner: "Sarah",
      due: "TBD"
    },
    {
      task: "Set up dashboard to track onboarding drop-off metrics",
      owner: "Sarah",
      due: "Before Monday launch"
    },
    {
      task: "Send out meeting notes",
      owner: "Sarah",
      due: "Today"
    }
  ],
  openQuestions: [
    {
      question: "Should bulk export support CSV only or also PDF? Waiting on customer survey results."
    },
    {
      question: "What are the specific drop-off thresholds that would trigger rollback of the new onboarding flow?"
    }
  ]
};
