/** A remote cursor resolved into the current Markdown coordinates. */
export interface Collaborator {
    clientId: string;
    userId: string;
    name: string;
    avatar: string;
    color: string;
    anchor: number;
    head: number;
    focused: boolean;
}
