import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Clock, LogOut, Shield, AlertCircle, CheckCircle, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import UserProfileForm from './UserProfileForm';
import ContactAdminForm from './ContactAdminForm';

export default function PendingApproval({ user }) {
  const [activeTab, setActiveTab] = useState(user?.primeiroAcesso ? 'profile' : 'contact');
  const [profileComplete, setProfileComplete] = useState(!user?.primeiroAcesso);

  const handleProfileSuccess = () => {
    setProfileComplete(true);
    setActiveTab('contact');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full">
        
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="p-5 bg-amber-100 rounded-full">
              <Clock className="h-12 w-12 text-amber-600" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-slate-900">Bem-vindo ao NOC Monitor</h1>
          <p className="text-slate-500 mt-2">Seu cadastro está em análise para aprovação</p>
        </div>

        {/* Status Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          <Card className={`border-2 ${profileComplete ? 'bg-emerald-50 border-emerald-300' : 'bg-slate-50 border-slate-300'}`}>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                {profileComplete ? (
                  <CheckCircle className="h-6 w-6 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="h-6 w-6 text-slate-400 shrink-0" />
                )}
                <div>
                  <p className="font-semibold text-sm text-slate-900">Perfil</p>
                  <p className="text-xs text-slate-500">{profileComplete ? 'Preenchido' : 'Pendente'}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-2 bg-slate-50 border-slate-300">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-6 w-6 text-slate-400 shrink-0" />
                <div>
                  <p className="font-semibold text-sm text-slate-900">Aprovação</p>
                  <p className="text-xs text-slate-500">Aguardando admin</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        {profileComplete && (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="profile">Meu Perfil</TabsTrigger>
              <TabsTrigger value="contact">Contato com Admin</TabsTrigger>
            </TabsList>

            <TabsContent value="profile">
              <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base">Informações do Perfil</CardTitle>
                  {!profileComplete && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setActiveTab('profile')}
                    >
                      Editar
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 text-sm">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-slate-500 font-medium">Primeiro Nome</p>
                        <p className="text-slate-900 font-medium">{user?.nome || '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 font-medium">Sobrenome</p>
                        <p className="text-slate-900 font-medium">{user?.sobrenome || '—'}</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 font-medium">Email</p>
                      <p className="text-slate-900 font-medium">{user?.email || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 font-medium">Telefone</p>
                      <p className="text-slate-900 font-medium">{user?.telefone || '—'}</p>
                    </div>
                    {user?.motivo_acesso && (
                      <div>
                        <p className="text-xs text-slate-500 font-medium">Motivo do Acesso</p>
                        <p className="text-slate-900">{user.motivo_acesso}</p>
                      </div>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setActiveTab('profile')}
                    className="mt-4 w-full gap-2"
                  >
                    Editar Perfil
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="contact">
              <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
                <CardHeader>
                  <CardTitle className="text-base">Enviar Mensagem ao Admin</CardTitle>
                  <p className="text-xs text-slate-500 mt-1">Comunique diretamente com o administrador sobre sua solicitação de acesso</p>
                </CardHeader>
                <CardContent>
                  <ContactAdminForm user={user} />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}

        {/* Profile Form (edit mode) */}
        {(activeTab === 'profile' && (!profileComplete || activeTab === 'profile')) && (
          <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50 mb-6">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                {profileComplete ? '✏️ Editar Perfil' : (
                  <>
                    <AlertCircle className="h-5 w-5 text-amber-600" />
                    Preencha Seu Perfil
                  </>
                )}
              </CardTitle>
              <p className="text-xs text-slate-500 mt-1">
                {profileComplete 
                  ? 'Altere suas informações e salve as mudanças'
                  : 'Complete as informações abaixo para solicitar acesso ao sistema'
                }
              </p>
            </CardHeader>
            <CardContent>
              <UserProfileForm user={user} onSuccess={handleProfileSuccess} isEditMode={profileComplete} />
            </CardContent>
          </Card>
        )}

        {/* Info Box */}
        <Card className="bg-blue-50 border-blue-200 mb-6">
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <Shield className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
              <div className="space-y-1.5 text-sm">
                <p className="font-semibold text-blue-900">O que acontece agora?</p>
                <ul className="space-y-1 text-blue-800 text-xs">
                  <li>✓ Seu perfil foi registado no sistema</li>
                  <li>✓ Um administrador será notificado para análise</li>
                  <li>✓ Você pode enviar uma mensagem ao admin usando a aba acima</li>
                  <li>✓ Após aprovação, terá acesso completo ao sistema</li>
                  <li>✓ Recarregue a página depois de aprovado</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Logout Button */}
        <Button
          variant="outline"
          onClick={() => base44.auth.logout()}
          className="w-full gap-2 text-slate-500"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </Button>
      </div>
    </div>
  );
}