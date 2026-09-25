// Preserve the desktop CandidateBridge asset, but omit all webpage Rename actions from user.js.
module.exports=function(source){
let candidate=source;
function candidateReplace(from,to){if(candidate.split(from).length!==2)throw Error('Candidate patch target not unique: '+from);candidate=candidate.replace(from,to);}
function candidateDrop(start,end){const a=candidate.indexOf(start),b=candidate.indexOf(end,a+start.length);if(a<0||b<0||candidate.indexOf(start,a+1)!==-1)throw Error('Candidate patch bounds changed: '+start);candidate=candidate.slice(0,a)+candidate.slice(b);}
candidateDrop(' // The current conversation\'s "More options" button in the sidebar.', ' window.__arenaCandidate=');
candidateReplace("if(!['Raw source','Preview','Download file','Expand panel','Rename'].includes(value))", "if(!['Raw source','Preview','Download file','Expand panel'].includes(value))");
candidateReplace("const b=value==='Rename'?all('[role=menuitem]').filter(e=>/^(Rename|重命名)$/.test(label(e))):button(value);", 'const b=button(value);');
candidateDrop("  if(action==='renameFill'||action==='renameSave'||action==='renameCancel'){", "  if(action==='state')return {");
candidateDrop("   renameDialog:all('[role=dialog]')", '   files:[...new Set(');
candidateDrop("  if(action==='ensureSidebar'){", "  throw Error('未知候选操作');");
return candidate;
};
