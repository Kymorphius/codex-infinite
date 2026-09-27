// Match the native control groups without moving React-owned buttons.
export const NATIVE_COMPOSER_RESPONSIVE_STYLE = `
[data-composer-surface-variant] :has(> [data-composer-navigation-target="permissions"]){
  display:flex!important;flex-wrap:wrap!important;flex:1 1 420px!important;
  min-width:0!important;max-width:100%;gap:6px!important;overflow:visible!important;
}
[data-composer-surface-variant] :has(> [data-composer-navigation-target="permissions"]) > *{
  flex-shrink:0!important;
}
[data-composer-surface-variant] :has(> * > [data-composer-navigation-target="permissions"]){
  flex-wrap:wrap!important;gap:8px!important;height:auto!important;overflow:visible!important;
}
`;
