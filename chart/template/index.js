export default window.define([], function(){
  return {
    paint: function($element, layout){
      const div = document.createElement('div');
      div.innerHTML = 'new';

      $element[0].appendChild(div);
    }
  }
})