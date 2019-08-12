export interface Config {
  jiraHost: string;
  jiraCookies: string;
  jiraUserName: string;
  jiraUserNameHuman: string;
  excludeProjects: Set<string>;
}
