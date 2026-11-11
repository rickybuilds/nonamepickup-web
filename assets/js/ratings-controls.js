"use strict";
// Shared searchable spotlight control. Consumers own eligibility and selection.
window.nnRatings = {
  createPlayerPicker(prefix, getPlayers, getSelected, onSelect) {
    const $ = suffix => document.getElementById(`${prefix}-player${suffix}`);
    let matches = [], active = -1, searching = false;
    function dismiss() {
      searching = false;
      $('-options').hidden = true;
      $('').setAttribute('aria-expanded', 'false');
      $('').setAttribute('aria-activedescendant', '');
      $('').value = getPlayers().find(p => String(p.id) === getSelected())?.player || '';
      $('-status').textContent = '';
    }
    function choose(player) { $('').focus(); onSelect(player); dismiss(); }
    function show() {
      const query = searching ? $('').value.trim().toLocaleLowerCase() : '';
      matches = getPlayers().filter(p => p.player.toLocaleLowerCase().includes(query));
      active = Math.min(active, matches.length - 1);
      $('-options').replaceChildren();
      matches.forEach((player,index) => {
        const option = document.createElement('span');
        option.id = `${prefix}-player-option-${index}`;
        option.setAttribute('role','option');
        option.setAttribute('aria-selected',String(index === active));
        option.textContent = player.player;
        option.addEventListener('mousedown',event=>event.preventDefault());
        option.addEventListener('click',()=>choose(player));
        $('-options').appendChild(option);
      });
      if (!matches.length) {
        const empty=document.createElement('span');
        empty.textContent = getPlayers().length ? 'No matching qualifying players. Try another name.' : 'No qualifying players available for these filters.';
        $('-options').appendChild(empty);
      }
      $('-options').hidden=false;
      $('').setAttribute('aria-expanded','true');
      $('').setAttribute('aria-activedescendant',active>=0 ? `${prefix}-player-option-${active}` : '');
      $('-status').textContent=`${matches.length} matching players`;
      $('-options').children[active]?.scrollIntoView?.({block:'nearest'});
    }
    $('').addEventListener('focus',()=>{active=-1;show();});
    $('').addEventListener('click',show);
    $('').addEventListener('input',()=>{searching=true;active=-1;show();});
    $('').addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();dismiss();}
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){
        event.preventDefault();
        if($('-options').hidden){active=-1;show();}
        active=matches.length?(active+(event.key==='ArrowDown'?1:active<0?0:-1)+matches.length)%matches.length:-1;
        show();
      }
      if(event.key==='Enter'&&!$('-options').hidden){event.preventDefault();if(active>=0)choose(matches[active]);}
      if(event.key==='Tab')dismiss();
    });
    $('-clear').addEventListener('click',()=>{$('').focus();$('').value='';searching=true;active=-1;show();});
    document.addEventListener('pointerdown',event=>{if(!$('-combo').contains(event.target))dismiss();});
    return {dismiss};
  }
};
