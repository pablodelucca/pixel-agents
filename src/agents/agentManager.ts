import { IAgent } from '../AgentProvider.type';
import { readConfig } from '../configPersistence.js';
import ClaudeManager from './ClaudeManager';
import GitHubCopilotManager from './GitHubCopilotManager';

type AgentSelect = 'cloud' | 'copilot';

/**
 * AgentManager is responsible for managing the current agent instance based on the user's selection. It allows switching between different agents (e.g., Claude, GitHub Copilot) and ensures that the correct agent instance is created and used throughout the application.
  @argument agentSelect - The type of agent to manage, either 'cloud' for Claude or 'copilot' for GitHub Copilot.
  @returns An instance of the selected agent that implements the IAgent interface.
*/
export default class AgentManager {
  private agentSelect: AgentSelect;
  public agent: IAgent;

  constructor(agentSelect: AgentSelect) {
    this.agentSelect = agentSelect;
    this.agent = this.createAgent(agentSelect);
  }

  switchAgent(agentSelect: AgentSelect): void {
    if (this.agentSelect === agentSelect) return;
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

/**
 * Initialize the AgentManager with the agent type specified in the configuration. This allows the application to use the selected agent throughout its lifecycle, and provides a centralized way to manage agent instances and switch between them if needed.
 */
const agentManager = new AgentManager(readConfig().agent_type);

export { agentManager };
