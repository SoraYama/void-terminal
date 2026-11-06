import {Terminal} from '../components/terminal';
import {deploymentMode} from '../lib/server/deployment';
import {supportConfig} from '../lib/server/support-config';
export const dynamic = 'force-dynamic';
export default function Page(){const mode=deploymentMode();return <Terminal deploymentMode={mode} support={supportConfig(mode)}/>}
