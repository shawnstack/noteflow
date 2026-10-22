export type WorkspaceTreeNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: WorkspaceTreeNode[]
}

export type WorkspaceChildrenResponse = {
  root: string
  path: string
  entries: WorkspaceTreeNode[]
  nextCursor: string | null
  truncated: boolean
}
