import { ExtensionContext, commands, window } from "vscode";
import { ConnectionStorage } from "./Storage";
import { getInstance } from "./base";
import { SQLJobManager } from "./connection/manager";
import { ServerComponent, UpdateStatus } from "./connection/serverComponent";
import { JobManagerView } from "./views/jobManager/jobManagerView";
import Configuration from "./configuration";
import { ConfigManager } from "./views/jobManager/ConfigManager";
import { Examples, ServiceInfoLabel } from "./views/examples";
import { updateStatusBar } from "./views/jobManager/statusBar";

interface IBMiLevels {
  version: number;
  db2Level: number;
}

export let Config: ConnectionStorage;
export let OSData: IBMiLevels|undefined;
export let JobManager: SQLJobManager = new SQLJobManager();

export async function onConnectOrServerInstall(): Promise<boolean> {
  const instance = getInstance();

  Config.setConnectionName(instance.getConnection().currentConnectionName);

  await ServerComponent.initialise().then(installed => {
    if (installed) {
      JobManagerView.setVisible(true);
    }
  });

  await ServerComponent.checkForUpdate();

  updateStatusBar();

  if (ServerComponent.isInstalled()) {
    JobManagerView.setVisible(true);

    let newJob = Configuration.get<string>(`alwaysStartSQLJob`) || `ask`;
    if (typeof newJob !== `string`) newJob = `ask`; //For legacy settings where it used to be a boolean

    switch (newJob) {
    case `ask`:
      return await askAboutNewJob(true);

    case `new`:
      await commands.executeCommand(`vscode-db2i.jobManager.newJob`);
      return true;

    case `never`:
      break;

    default:
      if (ConfigManager.getConfig(newJob)) {
        await commands.executeCommand(`vscode-db2i.jobManager.startJobFromConfig`, newJob);
      } else {
        await commands.executeCommand(`vscode-db2i.jobManager.newJob`);
        return true;
      }
      break;
    }
  }
  return false;
}

export function setupConfig(context: ExtensionContext) {
  Config = new ConnectionStorage(context);

  getInstance().onEvent(`connected`, onConnectOrServerInstall);

  getInstance().onEvent(`disconnected`, async () => {
    JobManagerView.setVisible(false);
    JobManager.endAll();
    updateStatusBar();

    // Remove old service examples
    delete Examples[ServiceInfoLabel];
    
    await commands.executeCommand(`vscode-db2i.resultset.reset`);
  });
}

export async function fetchSystemInfo() {
  const instance = getInstance();
  const content = instance.getContent();

  const [versionResults, db2LevelResults] = await Promise.all([
    content.runSQL(`select OS_VERSION concat '.' concat OS_RELEASE as VERSION from sysibmadm.env_sys_info`),
    content.runSQL([
      `select max(ptf_group_level) as HIGHEST_DB2_PTF_GROUP_LEVEL`,
      `from qsys2.group_ptf_info`,
      `where PTF_GROUP_DESCRIPTION like 'DB2 FOR IBM I%' and`,
      `ptf_group_status = 'INSTALLED';`
    ].join(` `))
  ]);

  const version = Number(versionResults[0].VERSION);
  const db2Level = Number(db2LevelResults[0].HIGHEST_DB2_PTF_GROUP_LEVEL);

  if (version && db2Level) {
    OSData = {
      version,
      db2Level
    }
  }
}

export async function askAboutNewJob(startup?: boolean): Promise<boolean> {
  const instance = getInstance();
  const connection = instance.getConnection();

  if (connection) {
    const options = startup ? [`Yes`, `Always`, `No`, `Never`] : [`Yes`, `No`];

    const chosen = await window.showInformationMessage(`Would you like to start an SQL Job?`, ...options);
    switch (chosen) {
      case `Yes`: 
      case `Always`:
        if (chosen === `Always`) {
          await Configuration.set(`alwaysStartSQLJob`, `new`);
        }

        await commands.executeCommand(`vscode-db2i.jobManager.newJob`);
        return true;

      case `Never`:
        await Configuration.set(`alwaysStartSQLJob`, `never`);
        break;
    }
  }

  return false;
}