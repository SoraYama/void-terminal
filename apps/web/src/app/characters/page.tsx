import {Terminal} from '../../components/terminal';
import {deploymentMode} from '../../lib/server/deployment';
import {supportConfig} from '../../lib/server/support-config';
export const dynamic = 'force-dynamic';
export default function CharactersPage(){const mode=deploymentMode();return <Terminal initialView="characters" deploymentMode={mode} support={supportConfig(mode)}/>}
