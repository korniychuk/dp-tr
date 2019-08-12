export interface Config {
  jiraHost: string;
  jiraLogin: string;
  jiraPassword: string;
  jiraUserName: string;
  jiraUserNameHuman: string;
  excludeProjects: Set<string>;
}
