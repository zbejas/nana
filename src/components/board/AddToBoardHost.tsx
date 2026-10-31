import { useAtomValue, useSetAtom } from 'jotai';
import { addToBoardRequestAtom } from '../../state/atoms';
import { AddToBoardPanel } from './AddToBoardPanel';

/**
 * One picker at the app root. Notes can start this flow from the sidebar,
 * Timeline, Folders, or a context menu; every entry point just sets the atom.
 */
export function AddToBoardHost() {
  const request = useAtomValue(addToBoardRequestAtom);
  const setRequest = useSetAtom(addToBoardRequestAtom);

  return <AddToBoardPanel request={request} onClose={() => setRequest(null)} />;
}
