// The tree rows of the reference meshes: one per mesh, below the reference rows. The id is `mesh:<id>`; the eye shows or hides it, the pencil (or a click) opens the Mesh panel.
import type { RefRow } from '@kit/ui';
import { t } from '../i18n';
import { meshesOf } from './meshDoc';

export const MESH_ROW = 'mesh:';

export function treeMeshRows(doc: unknown): RefRow[] {
  return meshesOf(doc).map((m) => ({ id: MESH_ROW + m.id, label: t('mesh.row', { name: m.name }), icon: 'add-sketch3d', editable: true, editLabel: t('mesh.rowEdit'), shown: m.visible }));
}
