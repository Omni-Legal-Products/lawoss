# Workspaces and chats

Open in LegalWork: [Home](legalwork://app/home), [Projects](legalwork://app/projects).

## Folders and workspaces

A workspace ties conversations and agent execution to a working directory or remote worker. Select the working context through **Projects** or the project sidebar. Create a project using a local folder, or use the connection flow for a remote worker. Selecting another workspace changes the files and runtime context used for new work.

Workspace settings include authorized folders. Global settings include model providers and the shared skill library. A remote worker may have different files, credentials, models and permissions from your local computer. Check the selected workspace before diagnosing missing files or tools.

**Projects** and **Project Home** provide matter details, linked folders and separate pages for files, chats, tasks, calendar, reviews and dashboards. See [Projects and sharing](projects-sharing.md). Sharing a project through the firm is different from the remote-worker connection described below.

Folder/workspace menus provide the actions available in this context, including renaming and opening another window. Removing a workspace connection is different from deleting files; read the confirmation for the specific action. A workspace export is not a backup of every cloud account, secret or remote source.

## Conversations

Choose **New Chat** in the selected workspace. The composer accepts a task, file attachments, `@` references and available slash commands. The model selector applies to the conversation. The assistant may ask a question or request permission while working; answer in the supplied controls. You can stop an active response and send a follow-up. Queued messages wait for the running work to reach the next opportunity to handle them.

Use a conversation's action menu to rename, pin, archive or delete it. Archiving preserves the conversation; deletion is a different action. Sidebar groups organize conversations, and moving a chat into a group does not move its underlying documents. Search can locate earlier chats by title or message text. Opening a previous chat is the way to resume its context; a new chat is not an assurance that the assistant remembers every prior conversation.

The command palette searches available navigation/actions. File/document tabs keep artifacts beside chat, and the terminal runs commands on the selected worker. A tab being open does not establish that its unsaved edits are already on disk. When a tool asks for permission or the assistant presents a question, respond in that control; stopping the response does not undo completed file changes.

When asking what was said previously, name the chat or topic and let the assistant read the returned transcript. A chat transcript is a record of that discussion, not independent evidence about a matter. For current matter facts, use the connected source documents.

## Remote access

Use the remote connection flow with a LegalWork worker URL and its access token/password. The host must be reachable and running. A collaborator connection has fewer administrative powers than owner/host access. Sharing a worker gives access to that runtime under its permissions; it does not make a folder publicly available by itself. Treat a sharing token as a credential. Check the sharing details again after switching the host's active local folder.

## Keyboard shortcuts

Use Command on macOS and Control elsewhere. In the chat shell: `Cmd/Ctrl+K` opens the command palette, `Cmd/Ctrl+Shift+F` searches sessions, `Cmd/Ctrl+J` toggles the terminal, and `Cmd/Ctrl+T` / `Cmd/Ctrl+Shift+T` moves between session tabs. `Cmd/Ctrl+N` creates a new chat when focus is not inside an editable field. These shortcuts are context-dependent; they are not Office shortcuts.

Related: [Tasks](tasks-intake.md), [Files](files-documents.md), [Troubleshooting](troubleshooting.md).
