from flask import Flask, render_template, request, jsonify
import secrets
import string

from password_store import PasswordStore

app = Flask(__name__)
store = PasswordStore()

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/ajouter', methods=['POST'])
def ajouter():
    data = request.json
    plateforme = data['plateforme']
    email = data['email']
    mdp = data['mdp']
    categorie = data.get('categorie', 'Perso')

    store.add_password(categorie, plateforme, email, mdp)

    return jsonify({'message': 'recu'})


@app.route('/ajouter-categorie', methods=['POST'])
def ajouter_categorie():
    data = request.json
    categorie = data['categorie']

    store.add_category(categorie)

    return jsonify({'message': 'recu'})


@app.route('/renommer-categorie', methods=['POST'])
def renommer_categorie():
    data = request.json
    ancien_nom = data['ancienNom']
    nouveau_nom = data['nouveauNom']

    store.rename_category(ancien_nom, nouveau_nom)

    return jsonify({'message': 'recu'})


@app.route('/charger', methods=['GET'])
def charger():
    return jsonify(store.load())


@app.route('/generer', methods=['GET'])
def generer():
    caractere = string.ascii_letters + string.digits + string.punctuation
    mdp_genere = ''.join(secrets.choice(caractere) for i in range(16))
    return jsonify({'mdp': mdp_genere})


if __name__ == '__main__':
    app.run(debug=True)
