import { IAgent } from './AgentProvider.type';
import ClaudeManager from './ClaudeManager';
import GitHubCopilotManager from './GitHubCopilotManager';

type AgentSelect = 'cloud' | 'copilot';

export default class AgentManager {
  private agentSelect: AgentSelect;
  public agent: IAgent;

  constructor(agentSelect: AgentSelect) {
    this.agentSelect = agentSelect;
    this.agent = this.createAgent(agentSelect);
  }

  private createAgent(agentSelect: AgentSelect): IAgent {
    switch (agentSelect) {
      case 'cloud':
        return new ClaudeManager();
      case 'copilot':
        return new GitHubCopilotManager();
      default:
        throw new Error(`Unknown agent select: ${agentSelect}`);
    }
  }
}

const agentManager = new AgentManager('copilot');

export { agentManager };
